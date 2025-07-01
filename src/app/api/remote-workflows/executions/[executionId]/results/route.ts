import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);
    console.log(`⚡ Fast execution results for ${executionIdNum} from Vercel...`);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get execution with workflow details in a single optimized query
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        started_at,
        completed_at,
        execution_duration_seconds,
        execution_params,
        results,
        error_message,
        modal_call_id,
        progress_percentage,
        current_step,
        total_steps,
        created_at,
        updated_at,
        deployed_workflows!inner(
          id,
          name,
          description,
          version,
          category
        )
      `)
      .eq('id', executionIdNum)
      .single();

    if (error || !execution) {
              return NextResponse.json(
          {
            success: false,
            error: `Execution ${executionIdNum} not found`,
            timestamp: new Date().toISOString()
          },
          { status: 404 }
        );
      }

      // Check if execution is completed
      if (execution.status !== 'completed') {
        return NextResponse.json(
          {
            success: false,
            error: `Execution ${executionIdNum} is not completed yet`,
            current_status: execution.status,
            message: execution.status === 'running' 
              ? 'Execution is still running. Check status endpoint for progress.'
              : execution.status === 'failed'
              ? 'Execution failed. Check error details.'
              : `Execution is in ${execution.status} state.`,
            status_endpoint: `/api/remote-workflows/executions/${executionIdNum}/status`,
            timestamp: new Date().toISOString()
          },
          { status: 409 }
        );
      }

    const workflow = Array.isArray(execution.deployed_workflows) 
      ? execution.deployed_workflows[0] 
      : execution.deployed_workflows;

    // Calculate execution metrics
    const startedAt = execution.started_at ? new Date(execution.started_at) : null;
    const completedAt = execution.completed_at ? new Date(execution.completed_at) : null;
    let executionTime = 0;
    
    if (startedAt && completedAt) {
      executionTime = Math.floor((completedAt.getTime() - startedAt.getTime()) / 1000);
    }

    // Format comprehensive results response
    const resultsResponse = {
      execution_info: {
        execution_id: execution.id,
        workflow_id: execution.workflow_id,
        workflow_name: workflow?.name || 'Unknown Workflow',
        workflow_description: workflow?.description || 'No description available',
        workflow_version: workflow?.version || '1.0.0',
        workflow_category: workflow?.category || 'general',
        status: execution.status,
        modal_call_id: execution.modal_call_id
      },
      
      execution_timing: {
        started_at: execution.started_at,
        completed_at: execution.completed_at,
        execution_duration_seconds: execution.execution_duration_seconds || executionTime,
        total_runtime_seconds: executionTime
      },
      
      execution_progress: {
        progress_percentage: execution.progress_percentage || 100,
        current_step: execution.current_step || execution.total_steps || 0,
        total_steps: execution.total_steps || 0,
        completion_status: 'fully_completed'
      },
      
      input_parameters: execution.execution_params || {},
      
      results: execution.results || {},
      
      execution_summary: {
        success: true,
        total_steps_completed: execution.total_steps || 0,
        error_count: 0,
        warning_count: 0,
        data_points_processed: execution.results?.processed_count || 0
      },
      
      metadata: {
        execution_created_at: execution.created_at,
        execution_updated_at: execution.updated_at,
        results_retrieved_at: new Date().toISOString()
      },
      
      related_endpoints: {
        workflow_details: `/api/remote-workflows/${execution.workflow_id}`,
        execution_status: `/api/remote-workflows/executions/${executionId}/status`,
        all_executions: `/api/remote-workflows/executions?workflow_id=${execution.workflow_id}`
      }
    };

    return NextResponse.json({
      success: true,
      execution_results: resultsResponse,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting execution results:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve execution results',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
