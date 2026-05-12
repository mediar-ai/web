import {
  describeCronExpression,
  parseCronExpression,
  shouldExecuteAt,
  getNextExecutionTime,
} from '@/lib/cronParser';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface ScheduledWorkflow {
  id: number;
  name: string;
  organization_id?: string | null;
  cron_expression: string;
  cron_timezone: string;
  cron_enabled: boolean;
  cron_auto_paused: boolean;
  last_scheduled_execution: string | null;
  next_scheduled_execution: string | null;
  cron_max_concurrent: number;
  cron_retry_on_failure: boolean;
  cron_retry_count: number;
  cron_executor_type?: 'python' | 'rust';
}

interface ExecutionResult {
  workflowId: number;
  workflowName: string;
  success: boolean;
  executionId?: number;
  error?: string;
  scheduledAt: string;
}

/**
 * Cron Scheduler API Route
 * Called every minute by Vercel Cron to check and execute scheduled workflows
 */
export async function POST(_request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const startTime = Date.now();
  const currentTime = new Date();

  console.log(`🕐 [${currentTime.toISOString()}] Cron scheduler started`);

  try {
    // 1. Get all active cron jobs from deployed_workflows_with_sequence view
    // Database is the single source of truth for cron configuration
    // IMPORTANT: Filter out auto-paused workflows to prevent execution after auto-pause
    const { data: workflows, error: fetchError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select(
        `
        id,
        name,
        organization_id,
        cron_expression,
        cron_timezone,
        cron_enabled,
        cron_auto_paused,
        last_scheduled_execution,
        next_scheduled_execution,
        cron_max_concurrent,
        cron_retry_on_failure,
        cron_retry_count,
        cron_executor_type
      `
      )
      .eq('cron_enabled', true)
      .eq('cron_auto_paused', false)
      .eq('status', 'deployed')
      .not('cron_expression', 'is', null);

    if (fetchError) {
      console.error('❌ Error fetching cron workflows:', fetchError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch workflows' },
        { status: 500 }
      );
    }

    if (!workflows || workflows.length === 0) {
      console.log('📭 No active cron workflows found');
      return NextResponse.json({
        success: true,
        message: 'No active cron workflows',
        executionsTriggered: 0,
        processingTimeMs: Date.now() - startTime,
      });
    }

    console.log(`📋 Found ${workflows.length} active cron workflows`);

    // 2. Check which workflows should execute now
    const workflowsToExecute: ScheduledWorkflow[] = [];
    const workflowUpdates: Array<{
      id: number;
      next_scheduled_execution: string;
    }> = [];

    for (const workflow of workflows as ScheduledWorkflow[]) {
      try {
        // Safety check: Skip if workflow is auto-paused (defense in depth)
        if (workflow.cron_auto_paused) {
          console.log(
            `⏸️  Skipping auto-paused workflow ${workflow.id} (${workflow.name})`
          );
          continue;
        }

        const cronExpression = workflow.cron_expression;
        const timezone = workflow.cron_timezone || 'UTC';

        // Validate cron expression
        const parsed = parseCronExpression(cronExpression);
        if (!parsed.isValid) {
          console.error(
            `❌ Invalid cron expression for workflow ${workflow.id} (${workflow.name}): ${parsed.error}`
          );
          continue;
        }

        // Check if workflow should execute at current time
        const shouldExecute = shouldExecuteAt(
          cronExpression,
          currentTime,
          timezone
        );
        console.log(
          `🔍 Checking ${workflow.name} (org: ${workflow.organization_id || 'none'}): expression=${cronExpression}, currentTime=${currentTime.toISOString()}, shouldExecute=${shouldExecute}`
        );
        if (shouldExecute) {
          // Check if we haven't already executed this minute
          const lastExecution = workflow.last_scheduled_execution
            ? new Date(workflow.last_scheduled_execution)
            : null;

          const currentMinute = new Date(currentTime);
          currentMinute.setSeconds(0, 0); // Round down to minute

          const shouldSkip =
            lastExecution &&
            lastExecution >= currentMinute &&
            lastExecution < new Date(currentMinute.getTime() + 60000);

          if (shouldSkip) {
            console.log(
              `⏭️  Workflow ${workflow.name} already executed this minute, skipping`
            );
            continue;
          }

          // Check concurrent executions
          const { count: runningExecutions } = await supabase
            .from('workflow_executions')
            .select('id', { count: 'exact', head: true })
            .eq('workflow_id', workflow.id)
            .in('status', ['queued', 'running']);

          if (
            runningExecutions &&
            runningExecutions >= workflow.cron_max_concurrent
          ) {
            console.log(
              `🚦 Workflow ${workflow.name} has ${runningExecutions} running executions (max: ${workflow.cron_max_concurrent}), skipping`
            );
            continue;
          }

          workflowsToExecute.push(workflow);
          console.log(
            `✅ Workflow ${workflow.name} scheduled for execution (${describeCronExpression(cronExpression)})`
          );
        }

        // Calculate next execution time using proper cron parser for each workflow's specific schedule
        const nextExecution = getNextExecutionTime(
          cronExpression,
          timezone,
          currentTime
        );
        if (nextExecution) {
          workflowUpdates.push({
            id: workflow.id,
            next_scheduled_execution: nextExecution.toISOString(),
          });
        }
      } catch (error) {
        console.error(
          `❌ Error processing workflow ${workflow.id} (${workflow.name}):`,
          error
        );
      }
    }

    // 3. Execute workflows
    const executionResults: ExecutionResult[] = [];

    for (const workflow of workflowsToExecute) {
      try {
        console.log(`🚀 Triggering execution for workflow: ${workflow.name}`);

        // Get exclusive machine assignment for this workflow
        let assignedMachineId: number | undefined = undefined;
        let shouldSkipExecution = false;
        let skipReason = '';

        try {
          const { data: exclusiveAssignment } = await supabase
            .from('workflow_machine_assignments')
            .select(
              `
              machine_id,
              assignment_type,
              remote_machines!inner(id, name, status, health_status)
            `
            )
            .eq('workflow_id', workflow.id)
            .eq('is_active', true)
            .eq('assignment_type', 'exclusive')
            .order('priority', { ascending: true })
            .limit(1)
            .single();

          if (exclusiveAssignment) {
            const machine = Array.isArray(exclusiveAssignment.remote_machines)
              ? exclusiveAssignment.remote_machines[0]
              : exclusiveAssignment.remote_machines;

            // EXCLUSIVE: Workflow MUST run on this machine only
            if (machine && machine.status === 'active') {
              // Check if machine has available capacity
              const { data: runningExecutions } = await supabase
                .from('workflow_executions')
                .select('id', { count: 'exact', head: true })
                .eq('assigned_machine_id', exclusiveAssignment.machine_id)
                .in('status', ['queued', 'running']);

              const { data: machineDetails } = await supabase
                .from('remote_machines')
                .select('max_concurrent_executions')
                .eq('id', exclusiveAssignment.machine_id)
                .single();

              const maxConcurrent =
                machineDetails?.max_concurrent_executions || 10;
              const currentLoad = runningExecutions || 0;

              if (currentLoad >= maxConcurrent) {
                // Exclusive machine at capacity - MUST skip execution
                shouldSkipExecution = true;
                skipReason = `Exclusive machine ${machine.name} (ID: ${exclusiveAssignment.machine_id}) at capacity (${currentLoad}/${maxConcurrent})`;
                console.log(
                  `   ⏸️  ${skipReason} - execution will be queued until capacity available`
                );
              } else {
                assignedMachineId = exclusiveAssignment.machine_id;
                console.log(
                  `   ✅ Using EXCLUSIVE machine ${machine.name} (ID: ${assignedMachineId}, capacity: ${currentLoad}/${maxConcurrent})`
                );
              }
            } else {
              // Exclusive machine inactive - MUST skip execution
              shouldSkipExecution = true;
              skipReason = `Exclusive machine ${machine?.name} (ID: ${exclusiveAssignment.machine_id}) is inactive`;
              console.log(
                `   ⏸️  ${skipReason} - execution cannot proceed without exclusive machine`
              );
            }
          }
        } catch (_machineErr) {
          // No exclusive assignment - continue with auto-assignment
          console.log(
            `   ℹ️  No exclusive assignment found for workflow ${workflow.id}, using auto-assignment`
          );
        }

        // Skip execution if exclusive machine is unavailable
        if (shouldSkipExecution) {
          console.log(`   ⏭️  Skipping execution: ${skipReason}`);
          executionResults.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            success: false,
            error: `Execution skipped: ${skipReason}`,
            scheduledAt: currentTime.toISOString(),
          });
          continue;
        }

        // Use public URL with service role key for authentication
        // Add the Vercel bypass token if available
        const vercelBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

        // In production, always use the production URL, not localhost
        const isProduction =
          process.env.NODE_ENV === 'production' ||
          process.env.VERCEL_ENV === 'production' ||
          process.env.VERCEL;

        const publicUrl = isProduction
          ? 'https://app.mediar.ai'
          : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

        let executionUrl = `${publicUrl}/api/remote-workflows/${workflow.id}/execute`;

        // Add bypass token to URL if available (for compatibility)
        if (vercelBypassToken) {
          executionUrl += `?x-vercel-protection-bypass=${vercelBypassToken}`;
        }
        console.log(`   Calling: ${executionUrl}`);

        // Build headers with bypass token
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'X-Cron-Execution': 'true',
        };

        // Also add bypass token as header for better security
        if (vercelBypassToken) {
          headers['x-vercel-protection-bypass'] = vercelBypassToken;
        }

        // Call the existing workflow execution API
        const executionResponse = await fetch(executionUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            parameters: {}, // Changed from execution_params to parameters
            client_id: 'cron-scheduler',
            ...(assignedMachineId && { machine_id: assignedMachineId }), // Include assigned machine if found
            // Only pass executor_type when explicitly configured on the cron job.
            // If unset, let the execute route auto-route based on preferred_format
            // (typescript -> rust, otherwise python). Forcing 'python' here would
            // break TS workflows that customers schedule via cron.
            ...(workflow.cron_executor_type && {
              executor_type: workflow.cron_executor_type,
            }),
          }),
        });

        console.log(`   Response status: ${executionResponse.status}`);

        if (executionResponse.ok) {
          const executionData = await executionResponse.json();
          console.log(
            `   Execution created: ${JSON.stringify(executionData).substring(0, 200)}`
          );
          executionResults.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            success: true,
            executionId: executionData.execution?.id,
            scheduledAt: currentTime.toISOString(),
          });

          // Update last execution timestamp
          await supabase
            .from('deployed_workflows')
            .update({
              last_scheduled_execution: currentTime.toISOString(),
            })
            .eq('id', workflow.id);

          console.log(
            `✅ Successfully triggered execution for ${workflow.name} (execution ID: ${executionData.execution?.id})`
          );
        } else {
          const errorText = await executionResponse.text();
          console.error(
            `❌ Failed to trigger execution for ${workflow.name}: ${executionResponse.status} ${errorText}`
          );

          executionResults.push({
            workflowId: workflow.id,
            workflowName: workflow.name,
            success: false,
            error: `HTTP ${executionResponse.status}: ${errorText}`,
            scheduledAt: currentTime.toISOString(),
          });
        }
      } catch (error) {
        console.error(`❌ Error executing workflow ${workflow.name}:`, error);
        executionResults.push({
          workflowId: workflow.id,
          workflowName: workflow.name,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          scheduledAt: currentTime.toISOString(),
        });
      }
    }

    // 4. Modal will process queued executions automatically
    console.log('✅ Queued executions will be processed by Modal scheduler');

    // 5. Update next execution times for enabled workflows that were processed
    if (workflowUpdates.length > 0) {
      for (const update of workflowUpdates) {
        await supabase
          .from('deployed_workflows')
          .update({ next_scheduled_execution: update.next_scheduled_execution })
          .eq('id', update.id);
      }
    }

    // 6. Also update next_scheduled_execution for ALL paused/disabled workflows
    // This ensures timers show correct values even for paused workflows
    const { data: pausedWorkflows } = await supabase
      .from('deployed_workflows')
      .select('id, cron_expression, cron_timezone')
      .eq('status', 'deployed')
      .not('cron_expression', 'is', null)
      .or(`cron_enabled.eq.false,cron_auto_paused.eq.true`);

    if (pausedWorkflows && pausedWorkflows.length > 0) {
      console.log(
        `📅 Updating next_scheduled_execution for ${pausedWorkflows.length} paused workflows`
      );
      for (const workflow of pausedWorkflows) {
        try {
          const nextExecution = getNextExecutionTime(
            workflow.cron_expression,
            workflow.cron_timezone || 'UTC',
            currentTime
          );
          if (nextExecution) {
            await supabase
              .from('deployed_workflows')
              .update({ next_scheduled_execution: nextExecution.toISOString() })
              .eq('id', workflow.id);
          }
        } catch (error) {
          console.error(
            `Error updating next execution for paused workflow ${workflow.id}:`,
            error
          );
        }
      }
    }

    const processingTime = Date.now() - startTime;
    const successfulExecutions = executionResults.filter(r => r.success).length;
    const failedExecutions = executionResults.filter(r => !r.success).length;

    console.log(`🏁 Cron scheduler completed in ${processingTime}ms`);
    console.log(
      `📊 Results: ${successfulExecutions} successful, ${failedExecutions} failed executions`
    );

    return NextResponse.json({
      success: true,
      timestamp: currentTime.toISOString(),
      processingTimeMs: processingTime,
      totalWorkflows: workflows.length,
      executionsTriggered: executionResults.length,
      successfulExecutions,
      failedExecutions,
      results: executionResults,
    });
  } catch (error) {
    console.error('❌ Cron scheduler error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: currentTime.toISOString(),
        processingTimeMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Cron endpoint - Vercel calls this with GET method
 * We handle both GET and POST the same way to trigger workflows
 */
export async function GET(request: NextRequest) {
  // Vercel cron uses GET, so we trigger workflows on GET too
  return POST(request);
}
// Trigger redeploy Thu, Dec  4, 2025  5:41:23 PM
