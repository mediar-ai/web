import { cacheResponse } from '@/lib/responseCache';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const workflow_id = searchParams.get('workflow_id');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '200');
    const offset = parseInt(searchParams.get('offset') || '0');
    const include_results = searchParams.get('include_results') === 'true';

    // Build base query - PERFORMANCE OPTIMIZED: exclude heavy JSONB fields by default
    // Heavy fields (execution_params, results) are only included when include_results=true
    const selectFields = include_results 
      ? 'id, workflow_id, status, started_at, completed_at, execution_duration_seconds, error_message, modal_call_id, execution_params, results, created_at, updated_at, progress_percentage, current_step_index, total_steps, formatted_output, version_number, workflow_version_id, deployed_workflows!inner(id, name, description, category)'
      : 'id, workflow_id, status, started_at, completed_at, execution_duration_seconds, error_message, modal_call_id, created_at, updated_at, progress_percentage, current_step_index, total_steps, formatted_output, version_number, workflow_version_id, deployed_workflows!inner(id, name, description, category)';
    
    let query = supabase
      .from('workflow_executions')
      .select(selectFields)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (workflow_id) {
      query = query.eq('workflow_id', parseInt(workflow_id));
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    const { data: executions, error } = await query;

    if (error) {
      console.error('Supabase query error in /api/remote-workflows/executions:', error);
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('workflow_executions')
      .select('*', { count: 'exact', head: true });
    
    if (workflow_id) {
      countQuery = countQuery.eq('workflow_id', parseInt(workflow_id));
    }
    if (status) {
      countQuery = countQuery.eq('status', status);
    }

    const { count: totalCount } = await countQuery;

    // Format executions with computed metrics
    const formattedExecutions = (executions || []).map(execution => {
      const executionAny = execution as any;
      const workflow = Array.isArray(executionAny.deployed_workflows) 
        ? executionAny.deployed_workflows[0] 
        : executionAny.deployed_workflows;

      // Calculate runtime
      const startedAt = executionAny.started_at ? new Date(executionAny.started_at) : null;
      const completedAt = executionAny.completed_at ? new Date(executionAny.completed_at) : null;
      const now = new Date();
      
      let runtimeSeconds = 0;
      if (startedAt) {
        const endTime = completedAt || (executionAny.status === 'running' ? now : null);
        if (endTime) {
          runtimeSeconds = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000);
        }
      }

      const formattedExecution = {
        execution_id: executionAny.id,
        workflow_id: executionAny.workflow_id,
        workflow_name: workflow?.name || 'Unknown Workflow',
        workflow_category: workflow?.category || 'general',
        
        status: executionAny.status,
        progress_percentage: executionAny.progress_percentage || 0,
        current_step_index: executionAny.current_step_index || 0,
        total_steps: executionAny.total_steps || 0,
        
        // Timing
        started_at: executionAny.started_at,
        completed_at: executionAny.completed_at,
        runtime_seconds: runtimeSeconds,
        execution_duration_seconds: executionAny.execution_duration_seconds,
        
        // Status flags
        is_running: executionAny.status === 'running',
        is_completed: ['completed', 'failed', 'cancelled'].includes(executionAny.status),
        is_successful: executionAny.status === 'completed',
        has_error: executionAny.status === 'failed' && !!executionAny.error_message,
        
        // Error info
        error_message: executionAny.error_message,
        formatted_output: executionAny.formatted_output,
        
        // Metadata
        modal_call_id: executionAny.modal_call_id,
        created_at: executionAny.created_at,
        updated_at: executionAny.updated_at,
        
        // Quick access URLs
        endpoints: {
          details: `/api/remote-workflows/executions/${executionAny.id}`,
          workflow_details: `/api/remote-workflows/${executionAny.workflow_id}`
        },
        
        // Conditionally include detailed data if requested
        ...(include_results && {
          execution_params: executionAny.execution_params || {},
          results: executionAny.results || {}
        })
      };

      return formattedExecution;
    });

    // Calculate summary statistics
    const summary = {
      total_executions: totalCount || 0,
      by_status: formattedExecutions.reduce((acc: Record<string, number>, exec) => {
        acc[exec.status] = (acc[exec.status] || 0) + 1;
        return acc;
      }, {}),
      successful_executions: formattedExecutions.filter(e => e.is_successful).length,
      failed_executions: formattedExecutions.filter(e => e.has_error).length,
      running_executions: formattedExecutions.filter(e => e.is_running).length
    };

    const responseData = {
      success: true,
      executions: formattedExecutions,
      summary,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit,
        current_page: Math.floor(offset / limit) + 1,
        total_pages: Math.ceil((totalCount || 0) / limit)
      },
      filters: {
        workflow_id: workflow_id ? parseInt(workflow_id) : null,
        status: status || 'all',
        include_results,
        applied_filters: {
          ...(workflow_id && { workflow_id: parseInt(workflow_id) }),
          ...(status && { status })
        }
      },
      timestamp: new Date().toISOString()
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/executions',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: {
        workflow_id: workflow_id ? parseInt(workflow_id) : null,
        status: status || null,
        limit,
        offset,
        include_results
      },
      executionTimeMs: 50 // placeholder
    });

    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('[ERROR] Error listing executions:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve executions',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 