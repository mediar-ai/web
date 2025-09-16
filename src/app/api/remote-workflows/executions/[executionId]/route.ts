import {
  cacheResponse,
  extractRequestParams,
  normalizeEndpointPath,
} from '@/lib/responseCache';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// Helper function to get API parameter names from workflow schema
async function getApiParameterNames(
  workflowId: number,
  executionParams: Record<string, unknown>
) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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
    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);
    console.log(`[PERF] Unified execution details for ${executionIdNum}...`);

    // Get URL parameters for controlling response detail level
    const { searchParams } = new URL(request.url);
    const full_detailed_response =
      searchParams.get('full_detailed_response') === 'true';

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get execution with all details including raw logs and formatted output
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('*, raw_logs, raw_mcp_response, execution_logs, formatted_output')
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

    // Get workflow details
    const { data: workflow } = await supabase
      .from('deployed_workflows')
      .select('id, name, description, version, category')
      .eq('id', execution.workflow_id)
      .single();

    // Calculate execution metrics
    const startedAt = execution.started_at
      ? new Date(execution.started_at)
      : null;
    const completedAt = execution.completed_at
      ? new Date(execution.completed_at)
      : null;
    const createdAt = execution.created_at
      ? new Date(execution.created_at)
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
      execution.status === 'running' || execution.status === 'queued';
    const isCompleted =
      execution.status === 'completed' ||
      execution.status === 'failed' ||
      execution.status === 'error';
    const isSuccessful = execution.status === 'completed';
    const hasFailed =
      execution.status === 'failed' || execution.status === 'error';
    const hasError = hasFailed || !!execution.error_message;

    // Build comprehensive response
    const response = {
      success: true,
      execution: {
        // Basic info
        execution_id: execution.id,
        workflow_id: execution.workflow_id,
        workflow_name: workflow?.name || 'Unknown Workflow',
        workflow_description:
          workflow?.description || 'No description available',
        workflow_version: workflow?.version || '1.0.0',
        workflow_category: workflow?.category || 'general',

        // Execution version info (the actual version that was executed)
        version_number: execution.version_number || execution.workflow_version_number,
        workflow_version_id: execution.workflow_version_id,

        // Status info
        status: execution.status,
        // Granular execution status from results (e.g., completed_with_errors)
        execution_status:
          execution.results?.execution_status || execution.status,
        is_running: isRunning,
        is_completed: isCompleted,
        is_successful: isSuccessful,
        has_failed: hasFailed,
        has_error: hasError,

        // Timing info
        created_at: execution.created_at,
        started_at: execution.started_at,
        completed_at: execution.completed_at,
        execution_duration_seconds:
          execution.execution_duration_seconds || runtimeSeconds,
        runtime_seconds: runtimeSeconds,

        // Progress info
        progress_percentage:
          execution.progress_percentage || (isCompleted ? 100 : 0),
        current_step_index: execution.current_step_index || 0,
        total_steps: execution.total_steps || 0,

        // Error info (if any)
        error_message: execution.error_message || null,
        error_details: execution.results?.error_details || null,

        // Execution details
        modal_call_id: execution.modal_call_id,
        client_id: execution.client_id,
        execution_params: execution.execution_params || {},

        // Include execution logs only in detailed response
        ...(full_detailed_response && {
          execution_logs: execution.execution_logs || [],
        }),

        // Request Parameters - Enhanced with both original and processed formats
        request_parameters: {
          // The parameters as sent in the original request
          original_request: execution.execution_params || {},

          // Parameter count for quick reference
          parameter_count: execution.execution_params
            ? Object.keys(execution.execution_params).length
            : 0,

          // Include expensive schema analysis only in detailed response
          ...(full_detailed_response && {
            api_parameter_names: execution.execution_params
              ? await getApiParameterNames(
                  execution.workflow_id,
                  execution.execution_params
                )
              : {},
          }),

          // Helper info
          note: full_detailed_response
            ? "Use 'original_request' to see exactly what was sent. Check API docs for current parameter schema."
            : "Use 'original_request' to see exactly what was sent. Add '?full_detailed_response=true' for schema analysis.",
        },

        // Results (only if completed or failed)
        results: isCompleted ? execution.results || {} : null,

        // Human-friendly formatted output (if available)
        formatted_output: execution.formatted_output || null,

        // Include raw data only in detailed response (for debugging)
        ...(full_detailed_response && {
          raw_data: {
            raw_logs: execution.raw_logs || null,
            raw_mcp_response: execution.raw_mcp_response || null,
            execution_logs: execution.execution_logs || [],
            has_raw_logs: !!execution.raw_logs,
            has_mcp_response: !!execution.raw_mcp_response,
            has_execution_logs: !!(
              execution.execution_logs && execution.execution_logs.length > 0
            ),
          },
        }),

        // Summary
        summary: {
          execution_successful: isSuccessful,
          workflow_completed:
            isSuccessful ||
            (hasFailed &&
              execution.results?.execution_summary?.workflow_completed),
          steps_completed:
            execution.results?.performance_metrics?.successful_steps || 0,
          steps_failed:
            execution.results?.performance_metrics?.failed_steps || 0,
          total_steps_attempted:
            execution.results?.performance_metrics?.total_steps ||
            execution.total_steps ||
            0,
          quotes_found: execution.results?.quotes?.length || 0,
          error_stage:
            execution.results?.error_stage || (hasError ? 'execution' : null),
        },

        // Include detailed metadata only in detailed response
        ...(full_detailed_response && {
          timestamps: {
            created_at: execution.created_at,
            updated_at: execution.updated_at,
            started_at: execution.started_at,
            completed_at: execution.completed_at,
            checked_at: new Date().toISOString(),
          },

          // Navigation
          related_endpoints: {
            workflow_details: `/api/remote-workflows/${execution.workflow_id}`,
            all_executions: `/api/remote-workflows/executions?workflow_id=${execution.workflow_id}`,
            execute_workflow: `/api/remote-workflows/${execution.workflow_id}/execute`,
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
    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables are not set' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch execution to validate status
    const { data: execution, error: fetchError } = await supabase
      .from('workflow_executions')
      .select('id, status, workflow_id')
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
