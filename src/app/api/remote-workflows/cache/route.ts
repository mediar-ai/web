import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

// Similarity scoring algorithm based on analysis of 3,933+ executions
function calculateSimilarityScore(
  requestParams: Record<string, unknown>, 
  candidateParams: Record<string, unknown>
): number {
  let totalScore = 0;

  // Helper function to normalize height to inches
  const normalizeHeight = (height: string | unknown): number => {
    if (typeof height !== 'string') return 0;
    const trimmed = height.trim();
    
    // Handle "5 10" format (feet inches)
    if (trimmed.match(/^\d+\s+\d+$/)) {
      const [feet, inches] = trimmed.split(' ').map(Number);
      return feet * 12 + inches;
    }
    
    // Handle "178" format (cm)
    if (trimmed.match(/^\d+$/)) {
      return Math.round(Number(trimmed) / 2.54); // Convert cm to inches
    }
    
    return 0;
  };

  // Helper function to calculate age from DOB
  const getAgeFromDOB = (dob: string | unknown): number => {
    if (typeof dob !== 'string') return 0;
    try {
      const year = parseInt(dob.split('/')[2]);
      return 2025 - year;
    } catch {
      return 0;
    }
  };

  // Helper function to calculate array overlap (for future product_types similarity if needed)
  // const calculateArrayOverlap = (arr1: unknown, arr2: unknown): number => {
  //   if (!Array.isArray(arr1) || !Array.isArray(arr2)) return 0;
  //   const set1 = new Set(arr1);
  //   const set2 = new Set(arr2);
  //   const intersection = new Set([...set1].filter(x => set2.has(x)));
  //   const union = new Set([...set1, ...set2]);
  //   return union.size > 0 ? intersection.size / union.size : 0;
  // };

  // HIGH IMPACT (70% total weight)
  
  // applicant_tobacco_usage (0.30 weight)
  const tobacco1 = requestParams.applicant_tobacco_usage;
  const tobacco2 = candidateParams.applicant_tobacco_usage;
  const tobaccoScore = tobacco1 === tobacco2 ? 1.0 : 0.0;
  totalScore += tobaccoScore * 0.30;

  // applicant_dob (0.20 weight) 
  const age1 = getAgeFromDOB(requestParams.applicant_dob);
  const age2 = getAgeFromDOB(candidateParams.applicant_dob);
  const ageDiff = Math.abs(age1 - age2);
  const ageScore = Math.max(0, 1 - Math.pow(ageDiff / 10, 2));
  totalScore += ageScore * 0.20;

  // applicant_gender (0.20 weight)
  const gender1 = requestParams.applicant_gender;
  const gender2 = candidateParams.applicant_gender;
  const genderScore = gender1 === gender2 ? 1.0 : 0.0;
  totalScore += genderScore * 0.20;

  // MEDIUM IMPACT (30% total weight)

  // applicant_state (0.15 weight)
  const state1 = requestParams.applicant_state;
  const state2 = candidateParams.applicant_state;
  const stateScore = state1 === state2 ? 1.0 : 0.4;
  totalScore += stateScore * 0.15;

  // quote_value (0.10 weight)
  const val1 = Number(requestParams.quote_value) || 0;
  const val2 = Number(candidateParams.quote_value) || 0;
  const maxVal = Math.max(val1, val2);
  const quoteScore = maxVal > 0 ? 1.0 - Math.min(1.0, Math.abs(val1 - val2) / maxVal) : 1.0;
  totalScore += quoteScore * 0.10;

  // quote_type (0.05 weight)
  const type1 = requestParams.quote_type;
  const type2 = candidateParams.quote_type;
  const typeScore = type1 === type2 ? 1.0 : 0.2;
  totalScore += typeScore * 0.05;

  // LOW IMPACT (5% total weight)

  // applicant_height (0.05 weight)
  const height1 = normalizeHeight(requestParams.applicant_height);
  const height2 = normalizeHeight(candidateParams.applicant_height);
  const heightDiff = Math.abs(height1 - height2);
  const heightScore = Math.max(0, 1 - (heightDiff / 12));
  totalScore += heightScore * 0.05;

  // IGNORED (0% weight - analysis showed no impact)
  // applicant_weight, applicant_zip_code, applicant_tobacco_usage omitted

  return Math.min(1.0, Math.max(0.0, totalScore));
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    
    console.log(`🎯 First trying exact hash-based lookup: ${parametersHash}`);

    // Step 1: Try exact hash lookup first (for perfect matches)
    let exactResults, exactError;
    
    if (full_detailed_response) {
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('id, formatted_output, created_at, execution_duration_seconds, results, raw_logs, raw_mcp_response, execution_logs, started_at, completed_at, updated_at, progress_percentage, current_step_index, total_steps, error_message, modal_call_id, client_id, execution_params, status')
        .eq('workflow_id', workflowIdNum)
        .in('status', statusFilter)
        .eq('execution_params_hash', parametersHash)
        .order('id', { ascending: false })
        .limit(1);
      exactResults = data;
      exactError = error;
    } else {
      const { data, error } = await supabase
        .from('workflow_executions')
        .select('id, formatted_output, created_at, execution_duration_seconds, started_at, completed_at, error_message, status, execution_params')
        .eq('workflow_id', workflowIdNum)
        .in('status', statusFilter)
        .eq('execution_params_hash', parametersHash)
        .order('id', { ascending: false })
        .limit(1);
      exactResults = data;
      exactError = error;
    }

    let cacheResults, cacheError;

    // If exact match found, use it
    if (exactResults && exactResults.length > 0) {
      console.log(`✅ Exact hash match found! Using perfect match.`);
      cacheResults = exactResults;
      cacheError = exactError;
    } else {
      // Step 2: No exact match - get candidates for similarity scoring
      console.log(`🔍 No exact match found. Getting candidates for similarity scoring (max 50 most recent)`);
      
      if (full_detailed_response) {
        const { data, error } = await supabase
          .from('workflow_executions')
          .select('id, formatted_output, created_at, execution_duration_seconds, results, raw_logs, raw_mcp_response, execution_logs, started_at, completed_at, updated_at, progress_percentage, current_step_index, total_steps, error_message, modal_call_id, client_id, execution_params, status')
          .eq('workflow_id', workflowIdNum)
          .in('status', statusFilter)
          .order('id', { ascending: false })
          .limit(50);
        cacheResults = data;
        cacheError = error;
      } else {
        const { data, error } = await supabase
          .from('workflow_executions')
          .select('id, formatted_output, created_at, execution_duration_seconds, started_at, completed_at, error_message, status, execution_params')
          .eq('workflow_id', workflowIdNum)
          .in('status', statusFilter)
          .order('id', { ascending: false })
          .limit(50);
        cacheResults = data;
        cacheError = error;
      }
    }

    if (cacheError) {
      throw cacheError;
    }

    const queryTime = Date.now() - startTime;

    if (cacheResults && cacheResults.length > 0) {
      let cacheHit: WorkflowExecutionCacheHit;
      let similarityScore = 1.0; // Default for exact matches
      let candidatesEvaluated = 1;
      let cacheMethod = 'exact_hash_match';

      // Check if we have multiple candidates (similarity scoring needed)
      if (cacheResults.length > 1 || !exactResults?.length) {
        console.log(`🧮 Scoring ${cacheResults.length} candidates using similarity algorithm`);
        
        // Score all candidates
        const scoredCandidates = cacheResults.map(candidate => {
          const score = calculateSimilarityScore(parameters, candidate.execution_params || {});
          return {
            ...candidate,
            similarity_score: score
          };
        });

        // Sort by highest similarity score
        scoredCandidates.sort((a, b) => b.similarity_score - a.similarity_score);
        
        const bestMatch = scoredCandidates[0];
        cacheHit = bestMatch as WorkflowExecutionCacheHit;
        similarityScore = bestMatch.similarity_score;
        candidatesEvaluated = scoredCandidates.length;
        cacheMethod = 'similarity_based';

        console.log(`🎯 Best match: Execution ${cacheHit.id} with similarity score ${similarityScore.toFixed(3)} (evaluated ${candidatesEvaluated} candidates)`);
      } else {
        // Single exact match
        cacheHit = cacheResults[0] as WorkflowExecutionCacheHit;
        console.log(`🎯 Using exact match: Execution ${cacheHit.id}`);
      }
      
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
      console.log(`[SUCCESS] Cache HIT! Execution ${cacheHit.id} (${cacheHit.status}) via ${cacheMethod} (similarity: ${similarityScore.toFixed(3)}) - ${queryTime}ms vs ${originalDuration}s original`);

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
            quote_count: quoteCount,
            similarity_score: similarityScore,
            cache_method: cacheMethod,
            candidates_evaluated: candidatesEvaluated
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
          quote_count: quoteCount,
          similarity_score: similarityScore,
          cache_method: cacheMethod,
          candidates_evaluated: candidatesEvaluated
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
export async function GET(_request: NextRequest) {
  try {
    // STEP 1: Authenticate and get org context
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId, isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'No organization context' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow IDs this organization has access to
    let accessibleWorkflowIds: number[] = [];

    if (isMediarOrg || isMediarAdmin) {
      // Mediar sees all workflows
      const { data: allWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id');
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
    } else {
      // Regular org sees only their workflows and shared workflows
      const { data: ownedWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('organization_id', orgId);

      const { data: sharedAccess } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id')
        .eq('organization_id', orgId);

      const ownedIds = (ownedWorkflows || []).map(w => w.id);
      const sharedIds = (sharedAccess || []).map(a => a.workflow_id);
      accessibleWorkflowIds = [...new Set([...ownedIds, ...sharedIds])];
    }

    if (accessibleWorkflowIds.length === 0) {
      return NextResponse.json({
        success: true,
        cache_statistics: {
          total_cacheable_executions: 0,
          breakdown: { completed_executions: 0, failed_executions: 0 },
          cacheable_parameter_patterns: 0,
          potential_cache_hits: 0,
          cache_hit_potential: '0%',
          note: 'No accessible workflows for this organization'
        },
        timestamp: new Date().toISOString()
      });
    }

    // STEP 3: Get cache statistics (filtered by accessible workflows only)
    const { data: stats, error: statsError } = await supabase
      .from('workflow_executions')
      .select('workflow_id, execution_params, status')
      .in('workflow_id', accessibleWorkflowIds)
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