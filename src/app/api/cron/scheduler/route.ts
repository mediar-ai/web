import {
  describeCronExpression,
  parseCronExpression,
  shouldExecuteAt,
} from '@/lib/cronParser';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ScheduledWorkflow {
  id: number;
  name: string;
  cron_expression: string;
  cron_timezone: string;
  cron_enabled: boolean;
  last_scheduled_execution: string | null;
  next_scheduled_execution: string | null;
  cron_max_concurrent: number;
  cron_retry_on_failure: boolean;
  cron_retry_count: number;
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
  const startTime = Date.now();
  const currentTime = new Date();

  console.log(`🕐 [${currentTime.toISOString()}] Cron scheduler started`);

  try {
    // 1. Get all active cron jobs from deployed_workflows_with_sequence view
    // This view joins with the active version, so we can check the YAML
    const { data: workflows, error: fetchError } = await supabase
      .from('deployed_workflows_with_sequence')
      .select(
        `
        id,
        name,
        cron_expression,
        cron_timezone,
        cron_enabled,
        last_scheduled_execution,
        next_scheduled_execution,
        cron_max_concurrent,
        cron_retry_on_failure,
        cron_retry_count,
        automation_sequence_yaml
      `
      )
      .eq('cron_enabled', true)
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

    for (const workflow of workflows as (ScheduledWorkflow & { automation_sequence_yaml?: string })[]) {
      try {
        // IMPORTANT: Verify that the active version's YAML actually has cron enabled
        // This prevents workflows from running when they shouldn't
        if (workflow.automation_sequence_yaml) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const yaml = require('js-yaml');
            const yamlContent = yaml.load(workflow.automation_sequence_yaml);

            // Check if cron is actually enabled in the YAML
            if (!yamlContent?.cron || yamlContent?.cron_enabled === false) {
              console.log(
                `⏭️  Workflow ${workflow.name} has cron_enabled in DB but not in active version YAML, skipping`
              );
              continue;
            }
          } catch (yamlError) {
            console.error(`❌ Failed to parse YAML for workflow ${workflow.id}:`, yamlError);
            continue;
          }
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
        if (shouldExecuteAt(cronExpression, currentTime, timezone)) {
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

        // Calculate next execution time (simplified - just add 1 minute for now)
        // In production, use a proper cron library for accurate next execution calculation
        const nextExecution = new Date(currentTime.getTime() + 60000);
        workflowUpdates.push({
          id: workflow.id,
          next_scheduled_execution: nextExecution.toISOString(),
        });
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

        // Get preferred machine for this workflow (only if healthy)
        let preferredMachineId: number | undefined = undefined;
        try {
          const { data: preferredAssignment } = await supabase
            .from('workflow_machine_assignments')
            .select(`
              machine_id,
              remote_machines!inner(id, name, status, health_status)
            `)
            .eq('workflow_id', workflow.id)
            .eq('is_active', true)
            .in('assignment_type', ['exclusive', 'preferred'])
            .order('priority', { ascending: true })
            .limit(1)
            .single();

          if (preferredAssignment) {
            const machine = Array.isArray(preferredAssignment.remote_machines)
              ? preferredAssignment.remote_machines[0]
              : preferredAssignment.remote_machines;

            // Use preferred machine if active (even if unhealthy - user explicitly chose it)
            // Only skip if machine is inactive
            if (machine && machine.status === 'active') {
              preferredMachineId = preferredAssignment.machine_id;
              console.log(`   Using preferred machine ${machine.name} (ID: ${preferredMachineId}, health: ${machine.health_status}) for workflow ${workflow.id}`);
            } else {
              console.log(`   Preferred machine ${machine?.name} (ID: ${preferredAssignment.machine_id}) is inactive, using auto-assignment`);
            }
          }
        } catch (_machineErr) {
          // No preferred machine - continue with auto-assignment
          console.log(`   No preferred machine found for workflow ${workflow.id}, using auto-assignment`);
        }

        // Use public URL with service role key for authentication
        // Add the Vercel bypass token if available, otherwise fall back to public URL
        const vercelBypassToken = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
        
        // In production, always use the production URL, not localhost
        const isProduction = process.env.NODE_ENV === 'production' || 
                           process.env.VERCEL_ENV === 'production' ||
                           process.env.VERCEL;
        
        const publicUrl = isProduction 
          ? 'https://app.mediar.ai'
          : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

        let executionUrl = `${publicUrl}/api/remote-workflows/${workflow.id}/execute`;

        // Add bypass token to URL if available  
        if (vercelBypassToken) {
          executionUrl += `?x-vercel-protection-bypass=${vercelBypassToken}`;
        }
        console.log(`   Calling: ${executionUrl}`);

        // Call the existing workflow execution API
        const executionResponse = await fetch(executionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'X-Cron-Execution': 'true',
          },
          body: JSON.stringify({
            parameters: {}, // Changed from execution_params to parameters
            client_id: 'cron-scheduler',
            ...(preferredMachineId && { machine_id: preferredMachineId }), // Include preferred machine if found
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

    // 5. Update next execution times for all workflows
    if (workflowUpdates.length > 0) {
      for (const update of workflowUpdates) {
        await supabase
          .from('deployed_workflows')
          .update({ next_scheduled_execution: update.next_scheduled_execution })
          .eq('id', update.id);
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
