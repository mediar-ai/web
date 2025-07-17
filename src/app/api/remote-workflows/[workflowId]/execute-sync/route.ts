import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { cacheResponse, extractRequestParams, normalizeEndpointPath } from '@/lib/responseCache';

// Types for execution and workflow data
interface ExecutionResults {
  execution_summary?: { workflow_completed?: boolean };
  performance_metrics?: { 
    successful_steps?: number; 
    failed_steps?: number; 
    total_steps?: number; 
  };
  quotes?: Array<unknown>;
  error_stage?: string;
  error_details?: unknown;
}

interface ExecutionData {
  id: number;
  workflow_id: number;
  status: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  execution_duration_seconds?: number;
  progress_percentage?: number;
  current_step_index?: number;
  total_steps?: number;
  error_message?: string;
  modal_call_id: string;
  client_id: string;
  execution_params?: Record<string, unknown>;
  results?: ExecutionResults;
  formatted_output?: string;
  raw_logs?: string;
  raw_mcp_response?: Record<string, unknown>;
  execution_logs?: Array<Record<string, unknown>>;
}

interface WorkflowData {
  id: number;
  name: string;
  description?: string;
  version?: string;
  category?: string;
  status: string;
}

// Maximum wait time for execution completion (5 minutes)
const MAX_WAIT_TIME_MS = 5 * 60 * 1000;
// Polling interval for checking execution status
const POLLING_INTERVAL_MS = 2000; // 2 seconds

// Helper function to sleep for specified milliseconds
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to poll execution status until completion
async function pollExecutionUntilComplete(executionId: number, supabase: SupabaseClient, startTime: number): Promise<ExecutionData> {
  while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
    // Get current execution status
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select('*, raw_logs, raw_mcp_response, execution_logs, formatted_output')
      .eq('id', executionId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch execution status: ${error.message}`);
    }

    // Check if execution is complete
    const isCompleted = execution.status === 'completed' || execution.status === 'failed' || execution.status === 'error';
    
    if (isCompleted) {
      return execution;
    }

    // Wait before next poll
    await sleep(POLLING_INTERVAL_MS);
  }

  // Execution timed out
  throw new Error(`Execution timed out after ${MAX_WAIT_TIME_MS / 1000} seconds`);
}

// Helper function to format execution response (similar to execution details endpoint)
function formatExecutionResponse(execution: ExecutionData, workflow: WorkflowData, full_detailed_response: boolean = false) {
  // Calculate execution metrics
  const startedAt = execution.started_at ? new Date(execution.started_at) : null;
  const completedAt = execution.completed_at ? new Date(execution.completed_at) : null;
  const createdAt = execution.created_at ? new Date(execution.created_at) : null;
  
  let runtimeSeconds = 0;
  if (startedAt && completedAt) {
    runtimeSeconds = Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000);
  } else if (createdAt && completedAt) {
    runtimeSeconds = Math.floor((completedAt.getTime() - createdAt.getTime()) / 1000);
  }

  // Determine execution state
  const isSuccessful = execution.status === 'completed';
  const hasFailed = execution.status === 'failed' || execution.status === 'error';
  const hasError = hasFailed || !!execution.error_message;

  // Return minimal response with only formatted_output when full_detailed_response is false
  if (!full_detailed_response) {
    return {
      success: true,
      execution: {
        execution_id: execution.id,
        workflow_id: execution.workflow_id,
        status: execution.status,
        formatted_output: execution.formatted_output || null,
      },
      response_metadata: {
        execution_mode: 'synchronous',
        full_detailed_response: false,
        note: 'Concise response with only formatted_output. Add "?full_detailed_response=true" for complete details.'
      },
      timestamp: new Date().toISOString()
    };
  }

  return {
    success: true,
    execution: {
      // Basic info
      execution_id: execution.id,
      workflow_id: execution.workflow_id,
      workflow_name: workflow?.name || 'Unknown Workflow',
      workflow_description: workflow?.description || 'No description available',
      workflow_version: workflow?.version || '1.0.0',
      workflow_category: workflow?.category || 'general',
      
      // Status info
      status: execution.status,
      is_successful: isSuccessful,
      has_failed: hasFailed,
      has_error: hasError,
      
      // Timing info
      created_at: execution.created_at,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      execution_duration_seconds: execution.execution_duration_seconds || runtimeSeconds,
      runtime_seconds: runtimeSeconds,
      
      // Progress info
      progress_percentage: execution.progress_percentage || 100,
      current_step_index: execution.current_step_index || 0,
      total_steps: execution.total_steps || 0,
      
      // Error info (if any)
      error_message: execution.error_message || null,
      error_details: execution.results?.error_details || null,
      
      // Execution details
      modal_call_id: execution.modal_call_id,
      client_id: execution.client_id,
      execution_params: execution.execution_params || {},
      
      // Request Parameters - Enhanced with both original and processed formats
      request_parameters: {
        // The parameters as sent in the original request
        original_request: execution.execution_params || {},
        
        // Parameter count for quick reference
        parameter_count: execution.execution_params ? Object.keys(execution.execution_params).length : 0,
        
        // Helper info
        note: full_detailed_response 
          ? "Parameters as sent in the original request"
          : "Parameters as sent in the original request. Add '?full_detailed_response=true' for additional analysis."
      },
      
      // Results (if completed)
      results: execution.results || null,
      
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
          has_execution_logs: !!(execution.execution_logs && execution.execution_logs.length > 0)
        }
      }),
      
      // Summary
      summary: {
        execution_successful: isSuccessful,
        workflow_completed: isSuccessful || (hasFailed && execution.results?.execution_summary?.workflow_completed),
        steps_completed: execution.results?.performance_metrics?.successful_steps || 0,
        steps_failed: execution.results?.performance_metrics?.failed_steps || 0,
        total_steps_attempted: execution.results?.performance_metrics?.total_steps || execution.total_steps || 0,
        quotes_found: execution.results?.quotes?.length || 0,
        error_stage: execution.results?.error_stage || (hasError ? 'execution' : null)
      }
    },
    response_metadata: {
      execution_mode: 'synchronous',
      full_detailed_response: full_detailed_response,
      note: 'Synchronous execution completed. Returns full detailed response including results, summary, and raw data.'
    },
    timestamp: new Date().toISOString()
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const startTime = Date.now();
  
  // Get URL parameters for controlling response detail level (declare outside try block)
  const { searchParams } = new URL(request.url);
  const full_detailed_response = searchParams.get('full_detailed_response') === 'true';
  
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    console.log(`🔄 Synchronous execution request for workflow ${workflowIdNum} (full_detailed_response: ${full_detailed_response})...`);

    // Parse request body
    const body = await request.json();
    const { parameters = {} } = body;
    const client_id = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get workflow details
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} not found`,
          timestamp: new Date().toISOString()
        },
        { status: 404 }
      );
    }

    if (workflow.status !== 'deployed') {
      return NextResponse.json(
        {
          success: false,
          error: `Workflow ${workflowIdNum} is not deployed (status: ${workflow.status})`,
          timestamp: new Date().toISOString()
        },
        { status: 400 }
      );
    }

    console.log(`✅ Found workflow "${workflow.name}" - checking cache first...`);

    // ✨ NEW: Check cache first for instant results
    try {
      // Pass detailed response parameter to cache endpoint to maintain consistency
      const cacheUrl = `${request.url.split('/api')[0]}/api/remote-workflows/cache${full_detailed_response ? '?detailed_output=true' : ''}`;
      
      const cacheResponse = await fetch(cacheUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: workflowIdNum,
          parameters: parameters
        })
      });

      if (cacheResponse.ok) {
        const cacheData = await cacheResponse.json();
        
        if (cacheData.success && cacheData.cached) {
          console.log(`🚀 Cache HIT! Returning instant results from execution ${cacheData.cache_info.source_execution_id}`);
          
          // Dispatch background execution job for cache freshness
          const background_modal_call_id = `modal_bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const backgroundExecution = await supabase
            .from('workflow_executions')
            .insert({
              workflow_id: workflowIdNum,
              client_id: `${client_id}_bg`,
              status: 'queued',
              execution_params: parameters,
              modal_call_id: background_modal_call_id
            })
            .select()
            .single();

          console.log(`📋 Dispatched background execution ${backgroundExecution.data?.id} to keep cache fresh`);

          // Return cache results with background execution info (using new cache response structure)
          const cachedExecution = cacheData.execution;
          
          return NextResponse.json({
            success: true,
            cached: true,
            execution: {
              // Use cached execution data with background execution info
              ...cachedExecution,
              
              // Override with background execution details for freshness tracking
              request_parameters: {
                ...cachedExecution.request_parameters,
                note: `Instant cache response from execution ${cacheData.cache_info.source_execution_id}. Background execution ${backgroundExecution.data?.id} queued for freshness.`
              }
            },
            cache_info: cacheData.cache_info,
            background_execution: {
              execution_id: backgroundExecution.data?.id,
              status: 'queued',
              message: 'Background execution dispatched to keep cache fresh'
            },
            response_metadata: {
              execution_mode: 'synchronous_cached',
              detail_level: full_detailed_response ? 'cache_full' : 'cache_basic',
              note: 'Returned cached results instantly while background execution updates cache'
            },
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (cacheError) {
      console.warn('⚠️ Cache lookup failed, proceeding with normal execution:', cacheError);
      // Continue with normal execution if cache fails
    }

    console.log(`⏳ No cache hit, proceeding with synchronous execution...`);

    // Create execution record in database with 'queued' status
    const modal_call_id = `modal_sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const { data: execution, error: executionError } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: workflowIdNum,
        client_id,
        status: 'queued',
        execution_params: parameters,
        modal_call_id
      })
      .select()
      .single();

    if (executionError) {
      throw executionError;
    }

    console.log(`✅ Created execution ${execution.id} - waiting for completion (max ${MAX_WAIT_TIME_MS / 1000}s)...`);

    // Poll execution until completion or timeout
    try {
      const completedExecution = await pollExecutionUntilComplete(execution.id, supabase, startTime);
      
      // Get updated workflow details
      const { data: updatedWorkflow } = await supabase
        .from('deployed_workflows')
        .select('id, name, description, version, category')
        .eq('id', workflowIdNum)
        .single();

      const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      console.log(`✅ Synchronous execution ${execution.id} completed in ${totalTimeSeconds}s`);

      // Format the response
      const responseData = formatExecutionResponse(completedExecution, updatedWorkflow || workflow, full_detailed_response);
      
      // Cache the successful response for documentation
      const endpointPath = normalizeEndpointPath(`/api/remote-workflows/[workflowId]/execute-sync`);
      const requestParams = extractRequestParams(request, { workflowId });
      await cacheResponse({
        endpointPath,
        httpMethod: 'POST',
        statusCode: 200,
        responseBody: responseData,
        requestParams,
        executionTimeMs: totalTimeSeconds * 1000
      });

      // Return formatted response
      return NextResponse.json(responseData);

    } catch {
      // Execution timed out - return partial response
      const { data: timeoutExecution } = await supabase
        .from('workflow_executions')
        .select('*, raw_logs, raw_mcp_response, execution_logs, formatted_output')
        .eq('id', execution.id)
        .single();

      const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
      console.warn(`⏰ Synchronous execution ${execution.id} timed out after ${totalTimeSeconds}s`);

      return NextResponse.json(
        {
          success: false,
          error: `Execution timed out after ${totalTimeSeconds} seconds`,
          execution: timeoutExecution ? formatExecutionResponse(timeoutExecution, workflow, full_detailed_response).execution : null,
          response_metadata: {
            execution_mode: 'synchronous',
            detail_level: full_detailed_response ? 'timeout_full' : 'timeout_basic',
            note: `Execution exceeded ${MAX_WAIT_TIME_MS / 1000} second timeout. Use /api/remote-workflows/executions/${execution.id} to check final status.`
          },
          timeout_info: {
            execution_id: execution.id,
            status_endpoint: `/api/remote-workflows/executions/${execution.id}`,
            max_wait_time_seconds: MAX_WAIT_TIME_MS / 1000,
            actual_wait_time_seconds: totalTimeSeconds
          },
          timestamp: new Date().toISOString()
        },
        { status: 408 } // Request Timeout
      );
    }

  } catch (error) {
    const totalTimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    console.error('❌ Error in synchronous execution:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute workflow synchronously',
        details: error instanceof Error ? error.message : String(error),
        response_metadata: {
          execution_mode: 'synchronous',
          detail_level: full_detailed_response ? 'error_full' : 'error_basic',
          note: 'Synchronous execution failed before completion'
        },
        execution_time_seconds: totalTimeSeconds,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 