import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

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

    // Build base query - use only existing database fields
    // Performance optimization: heavy fields (execution_params, results) are fetched but only included in response if requested
    let query = supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, started_at, completed_at, execution_duration_seconds, error_message, modal_call_id, execution_params, results, created_at, updated_at, progress_percentage, current_step_index, total_steps, formatted_output, deployed_workflows!inner(id, name, description, category)')
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
      const workflow = Array.isArray(execution.deployed_workflows) 
        ? execution.deployed_workflows[0] 
        : execution.deployed_workflows;

      // Calculate runtime
      const startedAt = execution.started_at ? new Date(execution.started_at) : null;
      const completedAt = execution.completed_at ? new Date(execution.completed_at) : null;
      const now = new Date();
      
      let runtimeSeconds = 0;
      if (startedAt) {
        const endTime = completedAt || (execution.status === 'running' ? now : null);
        if (endTime) {
          runtimeSeconds = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000);
        }
      }

      const formattedExecution = {
        execution_id: execution.id,
        workflow_id: execution.workflow_id,
        workflow_name: workflow?.name || 'Unknown Workflow',
        workflow_category: workflow?.category || 'general',
        
        status: execution.status,
        progress_percentage: execution.progress_percentage || 0,
        current_step_index: execution.current_step_index || 0,
        total_steps: execution.total_steps || 0,
        
        // Timing
        started_at: execution.started_at,
        completed_at: execution.completed_at,
        runtime_seconds: runtimeSeconds,
        execution_duration_seconds: execution.execution_duration_seconds,
        
        // Status flags
        is_running: execution.status === 'running',
        is_completed: ['completed', 'failed', 'cancelled'].includes(execution.status),
        is_successful: execution.status === 'completed',
        has_error: execution.status === 'failed' && !!execution.error_message,
        
        // Error info
        error_message: execution.error_message,
        formatted_output: execution.formatted_output,
        
        // Metadata
        modal_call_id: execution.modal_call_id,
        created_at: execution.created_at,
        updated_at: execution.updated_at,
        
        // Quick access URLs
        endpoints: {
          details: `/api/remote-workflows/executions/${execution.id}`,
          workflow_details: `/api/remote-workflows/${execution.workflow_id}`
        },
        
        // Conditionally include detailed data if requested
        ...(include_results && {
          execution_params: execution.execution_params || {},
          results: execution.results || {}
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
    console.error('❌ Error listing executions:', error);
    
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