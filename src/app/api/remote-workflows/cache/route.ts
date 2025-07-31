import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Type definition for workflow execution cache hit
interface WorkflowExecutionCacheHit {
  id: number;
  formatted_output?: string | null;
  created_at: string;
  execution_duration_seconds?: number | null;
  results?: {
    quotes?: unknown[];
    performance_metrics?: {
      successful_steps?: number;
      failed_steps?: number;
      total_steps?: number;
    };
  } | null;
  raw_logs?: string | null;
  raw_mcp_response?: unknown | null;
  execution_logs?: unknown[] | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  progress_percentage?: number | null;
  current_step_index?: number | null;
  total_steps?: number | null;
  error_message?: string | null;
  modal_call_id?: string | null;
  client_id?: string | null;
  execution_params?: Record<string, unknown> | null;
  status: 'completed' | 'failed'; // Will be filtered based on failed_only parameter
}

// Helper function to get API parameter names from workflow schema (copied from execution details endpoint)
async function getApiParameterNames(workflowId: number, executionParams: Record<string, unknown>) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return { error: "Database connection not available" };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get the workflow's automation sequence to understand parameter schema
    const { data: workflow } = await supabase
      .from('deployed_workflows_with_sequence')
      .select('automation_sequence')
      .eq('id', workflowId)
      .single();

    if (!workflow?.automation_sequence || !Array.isArray(workflow.automation_sequence) || workflow.automation_sequence.length === 0) {
      return { 
        message: "No schema available for this workflow",
        schema_endpoint: `/api/remote-workflows/${workflowId}/schema`
      };
    }

    // Extract the parameter schema from the automation sequence
    const mainSequence = workflow.automation_sequence[0];
    const variables = mainSequence?.arguments?.variables || {};
    
    // Flatten any nested structures to get the expected flat parameter names
    const flattenParameterNames = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const names: string[] = [];
      
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const valueObj = value as Record<string, unknown>;
          
          // Check if this is a parameter definition or a nested object
          if (valueObj.type || valueObj.description || valueObj.default !== undefined) {
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
      parameter_count_match: expectedParameterNames.length === actualParameterNames.length,
      schema_endpoint: `/api/remote-workflows/${workflowId}/schema`,
      docs_endpoint: `/docs/api/remote-workflows`
    };

  } catch (error) {
    return { 
      error: "Failed to analyze parameter schema",
      details: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Cache endpoint for instant quote retrieval based on parameters
 * 
 * POST /api/remote-workflows/cache
 * Body: { workflow_id: number, parameters: object }
 * Query Parameters:
 *   - full_detailed_response: Include raw data and debugging info (default: false)
 *   - failed_only: Only return failed executions for debugging (default: false, returns successful only)
 * 
 * Returns cached execution results if found, enabling instant responses
 * while background executions keep cache fresh.
 * 
 * By default, only successful (completed) cached results are returned.
 * This improves cache hit value since users typically want successful results.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  // Get URL parameters for controlling response detail level and cache filtering
  const { searchParams } = new URL(request.url);
  const full_detailed_response = searchParams.get('full_detailed_response') === 'true';
  const failed_only = searchParams.get('failed_only') === 'true';
  
  // Determine status filter: default to only successful results, unless specifically requesting failed ones
  const statusFilter = failed_only ? ['failed'] : ['completed'];
  
  try {
    const body = await request.json();
    const { workflow_id, parameters } = body;

    if (!workflow_id || !parameters) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: workflow_id and parameters',
          expected_format: {
            workflow_id: 1,
            parameters: { "param1": "value1" }
          }
        },
        { status: 400 }
      );
    }

    const workflowIdNum = parseInt(workflow_id.toString());
    
    console.log(`🔍 Cache lookup for workflow ${workflowIdNum} with parameters (full_detailed_response: ${full_detailed_response}):`, parameters);

    // Initialize Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate parameter hash for ultra-fast lookup (with consistent key ordering)
    const crypto = await import('crypto');
    
    // Helper function to sort JSON keys consistently (matching PostgreSQL JSONB behavior)
    const sortJsonKeys = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(sortJsonKeys);
      
      const sortedObj: Record<string, unknown> = {};
      Object.keys(obj as Record<string, unknown>).sort().forEach(key => {
        sortedObj[key] = sortJsonKeys((obj as Record<string, unknown>)[key]);
      });
      return sortedObj;
    };
    
    const sortedParameters = sortJsonKeys(parameters);
    const parametersJson = JSON.stringify(sortedParameters);
    const parametersHash = crypto.createHash('md5').update(parametersJson).digest('hex');
    
    console.log(`🎯 Using hash-based lookup: ${parametersHash}`);

    // Optimized cache lookup query using parameter hash for maximum speed
    let cacheResults, cacheError;
    
    if (full_detailed_response) {
      // Detailed query: Include ALL fields including heavy debugging data (raw_logs, raw_mcp_response, execution_logs)
      console.log(`🔍 Running DETAILED cache query with debugging fields (${failed_only ? 'failed only' : 'successful only'})`);
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('id, formatted_output, created_at, execution_duration_seconds, results, raw_logs, raw_mcp_response, execution_logs, started_at, completed_at, updated_at, progress_percentage, current_step_index, total_steps, error_message, modal_call_id, client_id, execution_params, status')
        .eq('workflow_id', workflowIdNum)
        .in('status', statusFilter)
        .eq('execution_params_hash', parametersHash)
        .order('id', { ascending: false })
        .limit(1);
      cacheResults = data;
      cacheError = error;
    } else {
      // Basic query: MINIMAL fields for maximum speed (excludes ALL heavy/optional debugging data)
      console.log(`[PERF] Running BASIC cache query with minimal fields (${failed_only ? 'failed only' : 'successful only'})`);
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('id, formatted_output, created_at, execution_duration_seconds, started_at, completed_at, error_message, status')
        .eq('workflow_id', workflowIdNum)
        .in('status', statusFilter)
        .eq('execution_params_hash', parametersHash)
        .order('id', { ascending: false })
        .limit(1);
      cacheResults = data;
      cacheError = error;
    }

    // Fallback to JSONB lookup if hash lookup didn't find anything (for backwards compatibility)
    if (cacheResults && cacheResults.length === 0) {
      console.log(`🔄 Hash lookup missed, falling back to JSONB lookup (${failed_only ? 'failed only' : 'successful only'})`);
      
      if (full_detailed_response) {
        console.log(`🔄 Fallback DETAILED JSONB query with all fields`);
        const { data, error } = await supabase
          .from('workflow_executions')
          .select('id, formatted_output, created_at, execution_duration_seconds, results, raw_logs, raw_mcp_response, execution_logs, started_at, completed_at, updated_at, progress_percentage, current_step_index, total_steps, error_message, modal_call_id, client_id, execution_params, status')
          .eq('workflow_id', workflowIdNum)
          .in('status', statusFilter)
          .eq('execution_params', JSON.stringify(parameters))
          .order('id', { ascending: false })
          .limit(1);
        cacheResults = data;
        cacheError = error;
      } else {
        console.log(`🔄 Fallback BASIC JSONB query with minimal fields`);
        const { data, error } = await supabase
          .from('workflow_executions')
          .select('id, formatted_output, created_at, execution_duration_seconds, started_at, completed_at, error_message, status')
          .eq('workflow_id', workflowIdNum)
          .in('status', statusFilter)
          .eq('execution_params', JSON.stringify(parameters))
          .order('id', { ascending: false })
          .limit(1);
        cacheResults = data;
        cacheError = error;
      }
    }

    if (cacheError) {
      throw cacheError;
    }

    const queryTime = Date.now() - startTime;

    if (cacheResults && cacheResults.length > 0) {
      const cacheHit = cacheResults[0] as WorkflowExecutionCacheHit;
      
      // Get workflow details for enhanced response
      const { data: workflow } = await supabase
        .from('deployed_workflows')
        .select('id, name, description, version, category')
        .eq('id', workflowIdNum)
        .single();

      // Parse formatted output for quotes
      let quotes = [];
      try {
        if (cacheHit.formatted_output) {
          quotes = typeof cacheHit.formatted_output === 'string' 
            ? JSON.parse(cacheHit.formatted_output)
            : cacheHit.formatted_output;
        }
      } catch (parseError) {
        console.warn('[WARN] Failed to parse formatted_output:', parseError);
        quotes = [];
      }

      // Calculate execution metrics
      const startedAt = cacheHit.started_at ? new Date(cacheHit.started_at) : null;
      const completedAt = cacheHit.completed_at ? new Date(cacheHit.completed_at) : null;
      const createdAt = cacheHit.created_at ? new Date(cacheHit.created_at) : null;
      
      let runtimeSeconds = 0;
      if (startedAt && completedAt) {
        runtimeSeconds = Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000);
      } else if (createdAt && completedAt) {
        runtimeSeconds = Math.floor((completedAt.getTime() - createdAt.getTime()) / 1000);
      }

      // Extract quote count from formatted_output for additional metadata (since results not fetched in basic mode)
      let quoteCount = 0;
      try {
        if (cacheHit.formatted_output) {
          const quotes = typeof cacheHit.formatted_output === 'string' 
            ? JSON.parse(cacheHit.formatted_output)
            : cacheHit.formatted_output;
          quoteCount = Array.isArray(quotes) ? quotes.length : 0;
        }
      } catch {
        // If formatted_output isn't parseable JSON, try to extract from results if available (detailed mode)
        if (cacheHit.results && typeof cacheHit.results === 'object' && cacheHit.results.quotes) {
          quoteCount = Array.isArray(cacheHit.results.quotes) ? cacheHit.results.quotes.length : 0;
        }
      }

      const originalDuration = cacheHit.execution_duration_seconds || runtimeSeconds;
      const speedImprovement = originalDuration > 0 ? Math.round((originalDuration * 1000) / queryTime) : 0;

      const isSuccessful = cacheHit.status === 'completed';
      console.log(`[SUCCESS] Cache HIT! Execution ${cacheHit.id} (${cacheHit.status}) - ${queryTime}ms vs ${originalDuration}s original`);

      // Return minimal response with only formatted_output when full_detailed_response is false
      if (!full_detailed_response) {
        return NextResponse.json({
          success: true,
          cached: true,
          execution: {
            execution_id: cacheHit.id,
            workflow_id: workflowIdNum,
            status: cacheHit.status,
            formatted_output: cacheHit.formatted_output || null,
          },
          cache_info: {
            source_execution_id: cacheHit.id,
            cache_timestamp: cacheHit.created_at,
            original_duration_seconds: originalDuration,
            cache_query_time_ms: queryTime,
            speed_improvement: `${speedImprovement}x faster`,
            quote_count: quoteCount
          },
          response_metadata: {
            execution_mode: 'synchronous_cached',
            full_detailed_response: false,
            note: 'Concise cached response with only formatted_output. Add "?full_detailed_response=true" for complete details.'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Build comprehensive response matching execution details endpoint structure
      const response = {
        success: true,
        cached: true,
        execution: {
          // Basic info
          execution_id: cacheHit.id,
          workflow_id: workflowIdNum,
          workflow_name: workflow?.name || 'Unknown Workflow',
          workflow_description: workflow?.description || 'No description available',
          workflow_version: workflow?.version || '1.0.0',
          workflow_category: workflow?.category || 'general',
          
          // Status info (based on actual cached execution status)
          status: cacheHit.status,
          is_running: false,
          is_completed: true,
          is_successful: isSuccessful,
          has_failed: !isSuccessful,
          has_error: !isSuccessful && !!cacheHit.error_message,
          
          // Timing info
          created_at: cacheHit.created_at,
          started_at: cacheHit.started_at,
          completed_at: cacheHit.completed_at,
          execution_duration_seconds: originalDuration,
          runtime_seconds: runtimeSeconds,
          
          // Progress info (available in detailed mode, defaults in basic mode)
          progress_percentage: cacheHit.progress_percentage || 100,
          current_step_index: cacheHit.current_step_index || 0,
          total_steps: cacheHit.total_steps || 0,
          
          // Error info (from cached execution)
          error_message: cacheHit.error_message || null,
          error_details: cacheHit.error_message || null,
          
          // Execution details (conditional based on query type)
          modal_call_id: full_detailed_response ? cacheHit.modal_call_id : null,
          client_id: full_detailed_response ? cacheHit.client_id : null,
          execution_params: full_detailed_response ? (cacheHit.execution_params || {}) : (parameters as Record<string, unknown>),
          
                          // Include execution logs only in detailed response
        ...(full_detailed_response && 'execution_logs' in cacheHit && {
          execution_logs: cacheHit.execution_logs || []
        }),

        // Request Parameters - Enhanced with schema analysis for detailed response
        request_parameters: {
          // The parameters as sent in the original request
          original_request: parameters,
          
          // Parameter count for quick reference
          parameter_count: Object.keys(parameters).length,
          
          // Include expensive schema analysis only in detailed response
          ...(full_detailed_response && {
            api_parameter_names: await getApiParameterNames(workflowIdNum, parameters)
          }),
          
          // Helper info
          note: full_detailed_response 
            ? "Cache response with full parameter analysis. Use 'original_request' to see exactly what was sent."
            : "Cache response with basic parameters. Add '?full_detailed_response=true' for schema analysis."
        },
        
        // Results (cached executions always have results)
        results: cacheHit.results || {},
        quotes: quotes,
        
        // Human-friendly formatted output (if available)
        formatted_output: cacheHit.formatted_output || null,
        
        // Include raw data only in detailed response (for debugging)
        ...(full_detailed_response && 'raw_logs' in cacheHit && {
          raw_data: {
            raw_logs: cacheHit.raw_logs || null,
            raw_mcp_response: cacheHit.raw_mcp_response || null,
            execution_logs: cacheHit.execution_logs || [],
            has_raw_logs: !!cacheHit.raw_logs,
            has_mcp_response: !!cacheHit.raw_mcp_response,
            has_execution_logs: !!(cacheHit.execution_logs && Array.isArray(cacheHit.execution_logs) && cacheHit.execution_logs.length > 0)
          }
        }),
          
          // Summary
          summary: {
            execution_successful: isSuccessful,
            workflow_completed: isSuccessful,
            steps_completed: cacheHit.results?.performance_metrics?.successful_steps || 0,
            steps_failed: cacheHit.results?.performance_metrics?.failed_steps || 0,
            total_steps_attempted: cacheHit.results?.performance_metrics?.total_steps || cacheHit.total_steps || 0,
            quotes_found: quoteCount,
            error_stage: isSuccessful ? null : (cacheHit.error_message ? 'execution' : 'unknown')
          },
          
          // Include detailed metadata only in detailed response
          ...(full_detailed_response && {
            timestamps: {
              created_at: cacheHit.created_at,
              ...(cacheHit.updated_at && { updated_at: cacheHit.updated_at }),
              started_at: cacheHit.started_at,
              completed_at: cacheHit.completed_at,
              checked_at: new Date().toISOString()
            },
            
            // Navigation
            related_endpoints: {
              workflow_details: `/api/remote-workflows/${workflowIdNum}`,
              all_executions: `/api/remote-workflows/executions?workflow_id=${workflowIdNum}`,
              execute_workflow: `/api/remote-workflows/${workflowIdNum}/execute`
            }
          }),
          
          // No polling needed for cached results
          next_poll_in_seconds: null
        },
        cache_info: {
          source_execution_id: cacheHit.id,
          cache_timestamp: cacheHit.created_at,
          original_duration_seconds: originalDuration,
          cache_query_time_ms: queryTime,
          speed_improvement: `${speedImprovement}x faster`,
          quote_count: quoteCount
        },
        response_metadata: {
          execution_mode: 'cached',
          detail_level: full_detailed_response ? 'full' : 'basic',
          note: full_detailed_response 
            ? 'Full detailed cached response including raw data, execution logs, and schema analysis'
            : 'Basic cached response. Add "?full_detailed_response=true" to include raw data, execution logs, and schema analysis'
        },
        timestamp: new Date().toISOString()
      };

      return NextResponse.json(response);
    } else {
      console.log(`[ERROR] Cache MISS for workflow ${workflowIdNum} (${queryTime}ms query) - ${failed_only ? 'no failed' : 'no successful'} executions found`);
      
      return NextResponse.json({
        success: true,
        cached: false,
        cache_info: {
          cache_query_time_ms: queryTime,
          message: `No cached ${failed_only ? 'failed' : 'successful'} results found for these parameters`,
          filter_applied: failed_only ? 'failed_only' : 'successful_only',
          note: failed_only 
            ? 'Add "?failed_only=false" or remove the parameter to search for successful results instead.'
            : 'Add "?failed_only=true" to specifically search for failed executions.'
        },
        data: null,
        response_metadata: {
          execution_mode: 'cached',
          detail_level: full_detailed_response ? 'full' : 'basic',
          note: full_detailed_response 
            ? `Cache miss - no ${failed_only ? 'failed' : 'successful'} detailed data available. Execute workflow to generate cached results.`
            : `Cache miss - no ${failed_only ? 'failed' : 'successful'} basic data available. Execute workflow to generate cached results.`
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    const queryTime = Date.now() - startTime;
    console.error('[ERROR] Cache lookup error:', error);
    
    return NextResponse.json(
      {
        success: false,
        cached: false,
        error: 'Cache lookup failed',
        details: error instanceof Error ? error.message : String(error),
        cache_info: {
          cache_query_time_ms: queryTime
        },
        response_metadata: {
          execution_mode: 'cached',
          detail_level: full_detailed_response ? 'full' : 'basic',
          note: 'Cache lookup error occurred'
        },
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for cache statistics and health check
 */
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get cache statistics (including both completed and failed executions)
    const { data: stats, error: statsError } = await supabase
      .from('workflow_executions')
      .select('workflow_id, execution_params, status')
      .in('status', ['completed', 'failed']);

    if (statsError) {
      throw statsError;
    }

    // Calculate cache potential (including both completed and failed)
    const parameterCounts: Record<string, number> = {};
    const statusBreakdown = { completed: 0, failed: 0 };
    
    stats?.forEach(execution => {
      const key = `${execution.workflow_id}:${JSON.stringify(execution.execution_params)}`;
      parameterCounts[key] = (parameterCounts[key] || 0) + 1;
      statusBreakdown[execution.status as 'completed' | 'failed']++;
    });

    const cacheablePatterns = Object.values(parameterCounts).filter(count => count > 1).length;
    const totalCacheableExecutions = Object.values(parameterCounts).reduce((sum, count) => sum + (count > 1 ? count - 1 : 0), 0);

    return NextResponse.json({
      success: true,
      cache_statistics: {
        total_cacheable_executions: stats?.length || 0,
        breakdown: {
          completed_executions: statusBreakdown.completed,
          failed_executions: statusBreakdown.failed
        },
        cacheable_parameter_patterns: cacheablePatterns,
        potential_cache_hits: totalCacheableExecutions,
        cache_hit_potential: totalCacheableExecutions > 0 ? `${Math.round((totalCacheableExecutions / (stats?.length || 1)) * 100)}%` : '0%',
        note: 'Cache now includes both successful and failed executions for complete coverage'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get cache statistics',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 