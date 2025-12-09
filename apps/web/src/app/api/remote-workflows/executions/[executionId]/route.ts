import {
  cacheResponse,
  extractRequestParams,
  normalizeEndpointPath,
} from '@/lib/responseCache';
import { redactSensitiveData } from '@/lib/redactSecrets';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Helper function to get API parameter names from workflow schema
async function getApiParameterNames(
  workflowId: number,
  executionParams: Record<string, unknown>
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return { error: 'Database connection not available' };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the workflow's automation sequence to understand parameter schema
    const { data: workflow } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('automation_sequence')
      .eq('id', workflowId)
      .single();

    if (
      !workflow?.automation_sequence ||
      !Array.isArray(workflow.automation_sequence) ||
      workflow.automation_sequence.length === 0
    ) {
      return {
        message: 'No schema available for this workflow',
        schema_endpoint: `/api/remote-workflows/${workflowId}/schema`,
      };
    }

    // Extract the parameter schema from the automation sequence
    const mainSequence = workflow.automation_sequence[0];
    const variables = mainSequence?.arguments?.variables || {};

    // Flatten any nested structures to get the expected flat parameter names
    const flattenParameterNames = (
      obj: Record<string, unknown>,
      prefix = ''
    ): string[] => {
      const names: string[] = [];

      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const valueObj = value as Record<string, unknown>;

          // Check if this is a parameter definition or a nested object
          if (
            valueObj.type ||
            valueObj.description ||
            valueObj.default !== undefined
          ) {
            // This is a parameter definition
            names.push(fullKey);
          } else {
            // This might be a nested group - recurse
            names.push(...flattenParameterNames(valueObj, fullKey));
          }
        }
      }

      return names;
    };

    const expectedParameterNames = flattenParameterNames(variables);
    const actualParameterNames = Object.keys(executionParams);

    return {
      expected_parameter_names: expectedParameterNames,
      actual_parameter_names: actualParameterNames,
      parameter_count_match:
        expectedParameterNames.length === actualParameterNames.length,
      schema_endpoint: `/api/remote-workflows/${workflowId}/schema`,
      docs_endpoint: `/docs/api/remote-workflows`,
    };
  } catch (error) {
    return {
      error: 'Failed to analyze parameter schema',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to execution details');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);
    console.log(`[PERF] Unified execution details for ${executionIdNum}...`);

    // Get URL parameters for controlling response detail level
    const { searchParams } = new URL(request.url);
    const full_detailed_response =
      searchParams.get('full_detailed_response') === 'true';

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Conditionally fetch heavy fields based on detail level requested
    const selectFields = full_detailed_response
      ? '*, raw_logs, execution_logs, results, formatted_output, screenshots'
      : 'id, workflow_id, status, started_at, completed_at, execution_duration_seconds, error_message, modal_call_id, execution_params, created_at, updated_at, progress_percentage, current_step_index, total_steps, formatted_output, version_number, workflow_version_id, client_id, assigned_machine_id, screenshots, executor_type, execution_logs, trace_id';

    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select(selectFields)
      .eq('id', executionIdNum)
      .single();

    if (error || !execution) {
      console.error('[ERROR] Error fetching execution:', error);

      const errorResponse = {
        success: false,
        error: `Execution ${executionIdNum} not found`,
        timestamp: new Date().toISOString(),
      };

      // Cache the error response for documentation
      const endpointPath = normalizeEndpointPath(
        '/api/remote-workflows/executions/[executionId]'
      );
      const requestParams = extractRequestParams(request, { executionId });
      await cacheResponse({
        endpointPath,
        httpMethod: 'GET',
        statusCode: 404,
        responseBody: errorResponse,
        requestParams,
      });

      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Type assertion to handle Supabase type inference issues
    const typedExecution = execution as any;

    // Validate required fields exist
    if (!typedExecution.workflow_id) {
      console.error('[ERROR] Execution missing workflow_id');
      return NextResponse.json(
        { success: false, error: 'Invalid execution data' },
        { status: 500 }
      );
    }

    // STEP 2: Get workflow details and verify authorization
    const { data: workflow } = await supabase
      .from('deployed_workflows')
      .select(
        'id, name, description, version, category, created_by, organization_id'
      )
      .eq('id', typedExecution.workflow_id)
      .single();

    if (!workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg =
      workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', typedExecution.workflow_id)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any execution)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (
      !isMediarOrg &&
      !isMediarAdmin &&
      !isOwner &&
      !(isOrgAdmin && isSameOrg) &&
      !hasOrgAccess
    ) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of execution ${executionIdNum} (workflow ${typedExecution.workflow_id})`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this execution' },
        { status: 403 }
      );
    }

    // Get assigned machine details if available
    let assignedMachineName = null;
    let assignedMachineMcpVersion = null;
    if (typedExecution.assigned_machine_id) {
      const { data: machine } = await supabase
        .from('remote_machines')
        .select('name, mcp_version')
        .eq('id', typedExecution.assigned_machine_id)
        .single();

      if (machine) {
        assignedMachineName = machine.name;
        assignedMachineMcpVersion = machine.mcp_version;
      }
    }

    // Calculate execution metrics
    const startedAt = typedExecution.started_at
      ? new Date(typedExecution.started_at)
      : null;
    const completedAt = typedExecution.completed_at
      ? new Date(typedExecution.completed_at)
      : null;
    const createdAt = typedExecution.created_at
      ? new Date(typedExecution.created_at)
      : null;

    let runtimeSeconds = 0;
    if (startedAt && completedAt) {
      runtimeSeconds = Math.floor(
        (completedAt.getTime() - startedAt.getTime()) / 1000
      );
    } else if (createdAt && completedAt) {
      // If started_at is null, use created_at
      runtimeSeconds = Math.floor(
        (completedAt.getTime() - createdAt.getTime()) / 1000
      );
    }

    // Determine execution state accurately
    const isRunning =
      typedExecution.status === 'running' || typedExecution.status === 'queued';
    const isCompleted =
      typedExecution.status === 'completed' ||
      typedExecution.status === 'failed' ||
      typedExecution.status === 'error';
    const isSuccessful = typedExecution.status === 'completed';
    const hasFailed =
      typedExecution.status === 'failed' || typedExecution.status === 'error';
    const hasError = hasFailed || !!typedExecution.error_message;

    // Transform execution_logs to the format expected by the UI
    const transformExecutionLogs = (logs: any): any[] => {
      if (!logs) return [];

      // If logs is already in the correct format (array of objects with timestamp, level, message)
      if (
        Array.isArray(logs) &&
        logs.length > 0 &&
        typeof logs[0] === 'object' &&
        'message' in logs[0]
      ) {
        return logs;
      }

      // If logs is an array of strings, transform to expected format
      if (Array.isArray(logs)) {
        return logs.map((log: any) => {
          // Try to parse timestamp and level from string format like "[2025-09-23T00:11:42.828574] Starting workflow..."
          const timestampMatch = String(log).match(/^\[([^\]]+)\]/);
          const timestamp = timestampMatch
            ? timestampMatch[1]
            : new Date().toISOString();
          const messageWithoutTimestamp = String(log).replace(
            /^\[[^\]]+\]\s*/,
            ''
          );

          // Try to detect log level from message content
          let level = 'info';
          if (
            messageWithoutTimestamp.toLowerCase().includes('error') ||
            messageWithoutTimestamp.toLowerCase().includes('fail')
          ) {
            level = 'error';
          } else if (messageWithoutTimestamp.toLowerCase().includes('warn')) {
            level = 'warn';
          } else if (
            messageWithoutTimestamp.toLowerCase().includes('success') ||
            messageWithoutTimestamp.toLowerCase().includes('complet')
          ) {
            level = 'success';
          }

          return {
            timestamp,
            level,
            message: messageWithoutTimestamp,
          };
        });
      }

      return [];
    };

    // Build comprehensive response
    const response = {
      success: true,
      execution: {
        // Basic info
        execution_id: typedExecution.id,
        workflow_id: typedExecution.workflow_id,
        workflow_name: workflow?.name || 'Unknown Workflow',
        workflow_description:
          workflow?.description || 'No description available',
        workflow_version: workflow?.version || '1.0.0',
        workflow_category: workflow?.category || 'general',

        // Execution version info (the actual version that was executed)
        version_number:
          typedExecution.version_number ||
          typedExecution.workflow_version_number,
        workflow_version_id: typedExecution.workflow_version_id,

        // Status info
        status: typedExecution.status,
        // Granular execution status from results (e.g., completed_with_errors)
        execution_status:
          (typedExecution.results && typedExecution.results.execution_status) ||
          typedExecution.status,
        is_running: isRunning,
        is_completed: isCompleted,
        is_successful: isSuccessful,
        has_failed: hasFailed,
        has_error: hasError,

        // Timing info
        created_at: typedExecution.created_at,
        started_at: typedExecution.started_at,
        completed_at: typedExecution.completed_at,
        execution_duration_seconds:
          typedExecution.execution_duration_seconds || runtimeSeconds,
        runtime_seconds: runtimeSeconds,

        // Progress info
        progress_percentage:
          typedExecution.progress_percentage || (isCompleted ? 100 : 0),
        current_step_index: typedExecution.current_step_index || 0,
        total_steps: typedExecution.total_steps || 0,

        // Error info (if any)
        error_message: typedExecution.error_message || null,
        error_details:
          (typedExecution.results && typedExecution.results.error_details) ||
          null,

        // Execution details
        modal_call_id: typedExecution.modal_call_id,
        client_id: typedExecution.client_id,
        execution_params: redactSensitiveData(
          typedExecution.execution_params || {}
        ),

        // Machine assignment info
        assigned_machine_id: typedExecution.assigned_machine_id || null,
        executor_type: typedExecution.executor_type,
        assigned_machine_name: assignedMachineName,
        assigned_machine_mcp_version: assignedMachineMcpVersion,

        // Transform and include execution logs (always include for completed executions)
        execution_logs: transformExecutionLogs(typedExecution.execution_logs),

        // Request Parameters - Enhanced with both original and processed formats
        request_parameters: {
          // The parameters as sent in the original request (sensitive data redacted)
          original_request: redactSensitiveData(
            typedExecution.execution_params || {}
          ),

          // Parameter count for quick reference
          parameter_count: typedExecution.execution_params
            ? Object.keys(typedExecution.execution_params).length
            : 0,

          // Include expensive schema analysis only in detailed response
          ...(full_detailed_response && {
            api_parameter_names: typedExecution.execution_params
              ? await getApiParameterNames(
                  typedExecution.workflow_id,
                  typedExecution.execution_params
                )
              : {},
          }),

          // Helper info
          note: full_detailed_response
            ? "Use 'original_request' to see exactly what was sent. Check API docs for current parameter schema."
            : "Use 'original_request' to see exactly what was sent. Add '?full_detailed_response=true' for schema analysis.",
        },

        // Results (only if completed and available)
        results:
          isCompleted && typedExecution.results
            ? redactSensitiveData(typedExecution.results)
            : null,

        // Human-friendly formatted output (if available)
        formatted_output: typedExecution.formatted_output || null,

        // Monitor screenshots (if available)
        screenshots: typedExecution.screenshots || null,

        // Include raw data only in detailed response (for debugging)
        ...(full_detailed_response && {
          raw_data: {
            raw_logs: typedExecution.raw_logs || null,
            execution_logs: typedExecution.execution_logs || [],
            has_raw_logs: !!typedExecution.raw_logs,
            has_execution_logs: !!(
              typedExecution.execution_logs &&
              typedExecution.execution_logs.length > 0
            ),
          },
        }),

        // Summary
        summary: {
          execution_successful: isSuccessful,
          workflow_completed:
            isSuccessful ||
            (hasFailed &&
              typedExecution.results &&
              typedExecution.results.execution_summary &&
              typedExecution.results.execution_summary.workflow_completed),
          steps_completed:
            (typedExecution.results &&
              typedExecution.results.performance_metrics &&
              typedExecution.results.performance_metrics.successful_steps) ||
            0,
          steps_failed:
            (typedExecution.results &&
              typedExecution.results.performance_metrics &&
              typedExecution.results.performance_metrics.failed_steps) ||
            0,
          total_steps_attempted:
            (typedExecution.results &&
              typedExecution.results.performance_metrics &&
              typedExecution.results.performance_metrics.total_steps) ||
            typedExecution.total_steps ||
            0,
          quotes_found:
            (typedExecution.results &&
              typedExecution.results.quotes &&
              typedExecution.results.quotes.length) ||
            0,
          error_stage:
            (typedExecution.results && typedExecution.results.error_stage) ||
            (hasError ? 'execution' : null),
        },

        // Include detailed metadata only in detailed response
        ...(full_detailed_response && {
          timestamps: {
            created_at: typedExecution.created_at,
            updated_at: typedExecution.updated_at,
            started_at: typedExecution.started_at,
            completed_at: typedExecution.completed_at,
            checked_at: new Date().toISOString(),
          },

          // Navigation
          related_endpoints: {
            workflow_details: `/api/remote-workflows/${typedExecution.workflow_id}`,
            all_executions: `/api/remote-workflows/executions?workflow_id=${typedExecution.workflow_id}`,
            execute_workflow: `/api/remote-workflows/${typedExecution.workflow_id}/execute`,
          },
        }),

        // Polling hint
        next_poll_in_seconds: isRunning ? 2 : null,
      },
      response_metadata: {
        full_detailed_response,
        detail_level: full_detailed_response ? 'full' : 'basic',
        note: full_detailed_response
          ? 'Showing full detailed response including raw data, execution logs, and schema analysis'
          : 'Showing basic response. Add "?full_detailed_response=true" to include raw data, execution logs, and schema analysis',
      },
      timestamp: new Date().toISOString(),
    };

    // Cache the successful response for documentation
    const endpointPath = normalizeEndpointPath(
      '/api/remote-workflows/executions/[executionId]'
    );
    const requestParams = extractRequestParams(request, { executionId });
    await cacheResponse({
      endpointPath,
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: response,
      requestParams,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[ERROR] Error getting execution details:', error);

    const errorResponse = {
      success: false,
      error: 'Failed to retrieve execution details',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };

    // Cache the error response for documentation
    try {
      const endpointPath = normalizeEndpointPath(
        '/api/remote-workflows/executions/[executionId]'
      );
      const requestParams = extractRequestParams(request);
      await cacheResponse({
        endpointPath,
        httpMethod: 'GET',
        statusCode: 500,
        responseBody: errorResponse,
        requestParams,
      });
    } catch (cacheError) {
      console.warn('Failed to cache error response:', cacheError);
    }

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to delete execution');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables are not set' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Fetch execution and workflow to check authorization
    const { data: execution, error: fetchError } = await supabase
      .from('workflow_executions')
      .select(
        `
        id,
        status,
        workflow_id,
        deployed_workflows!inner(
          id,
          name,
          created_by,
          organization_id
        )
      `
      )
      .eq('id', executionIdNum)
      .single();

    if (fetchError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch execution',
          details: fetchError.message,
        },
        { status: 500 }
      );
    }

    if (!execution) {
      return NextResponse.json(
        { success: false, error: `Execution ${executionIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const workflow = Array.isArray((execution as any).deployed_workflows)
      ? (execution as any).deployed_workflows[0]
      : (execution as any).deployed_workflows;
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg =
      workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', (execution as any).workflow_id)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow deletion if:
    // - User is in Mediar org or is a Mediar admin (can delete any execution)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (
      !isMediarOrg &&
      !isMediarAdmin &&
      !isOwner &&
      !(isOrgAdmin && isSameOrg) &&
      !hasOrgAccess
    ) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized delete for execution ${executionIdNum} (workflow ${(execution as any).workflow_id})`
      );
      return NextResponse.json(
        {
          error:
            'Forbidden - You do not have permission to delete this execution',
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    if (
      (execution as any).status === 'running' ||
      (execution as any).status === 'queued'
    ) {
      if (!force) {
        return NextResponse.json(
          {
            success: false,
            error:
              'Execution is active and cannot be deleted while running. Cancel it first or use ?force=true to cancel and delete.',
          },
          { status: 409 }
        );
      }

      // Best-effort cancel before deletion
      const { error: cancelError } = await supabase
        .from('workflow_executions')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
          error_message: 'Cancelled by client request (force delete)',
        })
        .eq('id', executionIdNum);

      if (cancelError) {
        // Log but proceed to delete to honor force
        console.warn(
          '[WARN] Failed to cancel before delete:',
          cancelError.message
        );
      }
    }

    const { error: deleteError } = await supabase
      .from('workflow_executions')
      .delete()
      .eq('id', executionIdNum);

    if (deleteError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to delete execution',
          details: deleteError.message,
        },
        { status: 500 }
      );
    }

    // Recalculate workflow statistics so overall metrics stay consistent
    try {
      if ((execution as any).workflow_id) {
        const { error: recalcError } = await supabase.rpc(
          'recalculate_workflow_statistics',
          { p_workflow_id: (execution as any).workflow_id }
        );
        if (recalcError) {
          console.warn(
            '[WARN] Failed to recalculate workflow statistics:',
            recalcError.message
          );
        }
      }
    } catch (e) {
      console.warn(
        '[WARN] Error invoking recalculate_workflow_statistics:',
        e instanceof Error ? e.message : String(e)
      );
    }

    return NextResponse.json({ success: true, message: 'Execution deleted' });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
