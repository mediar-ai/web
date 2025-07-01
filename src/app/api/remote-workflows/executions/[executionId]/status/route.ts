import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;
    const executionIdNum = parseInt(executionId);
    console.log(`⚡ Fast execution status for ${executionIdNum} from Vercel...`);
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fast status lookup - optimized for frequent polling
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        started_at,
        completed_at,
        execution_duration_seconds,
        error_message,
        modal_call_id,
        execution_params,
        created_at,
        updated_at
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

    // Calculate derived status info
    const now = new Date();
    const startedAt = execution.started_at ? new Date(execution.started_at) : null;
    const completedAt = execution.completed_at ? new Date(execution.completed_at) : null;
    
    let runtimeSeconds = 0;
    if (startedAt) {
      const endTime = completedAt || now;
      runtimeSeconds = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000);
    }

    // Format status response for polling
    const statusResponse = {
      execution_id: execution.id,
      workflow_id: execution.workflow_id,
      status: execution.status,
      
      // Timing information
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      runtime_seconds: runtimeSeconds,
      execution_duration_seconds: execution.execution_duration_seconds,
      
      // Progress tracking (simulated from status)
      progress_percentage: execution.status === 'completed' ? 100 : execution.status === 'running' ? 50 : 0,
      current_step: execution.status === 'completed' ? 1 : 0,
      total_steps: 1, // Will be updated when we add these columns
      
      // Status flags for UI
      is_running: execution.status === 'running',
      is_completed: ['completed', 'failed', 'cancelled'].includes(execution.status),
      is_successful: execution.status === 'completed',
      has_error: execution.status === 'failed' && !!execution.error_message,
      
      // Error information (if any)
      error_message: execution.error_message,
      
      // Execution metadata
      modal_call_id: execution.modal_call_id,
      execution_params: execution.execution_params,
      
      // Next poll recommendation (for efficient polling)
      next_poll_in_seconds: execution.status === 'running' ? 2 : 
                           execution.status === 'queued' ? 5 : null,
      
      // Links to related endpoints
      related_endpoints: {
        results: execution.status === 'completed' ? `/api/remote-workflows/executions/${executionIdNum}/results` : null,
        workflow_details: `/api/remote-workflows/${execution.workflow_id}`
      },
      
      timestamps: {
        created_at: execution.created_at,
        updated_at: execution.updated_at,
        checked_at: now.toISOString()
      }
    };

    return NextResponse.json({
      success: true,
      execution: statusResponse,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting execution status:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve execution status',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// Cancel execution endpoint
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const { executionId } = await params;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Check if execution can be cancelled
    const { data: execution, error: fetchError } = await supabase
      .from('workflow_executions')
      .select('id, status, modal_call_id')
      .eq('id', executionId)
      .single();

    if (fetchError) throw fetchError;
    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    if (!['queued', 'running'].includes(execution.status)) {
      return NextResponse.json({ 
        error: 'Execution cannot be cancelled', 
        current_status: execution.status 
      }, { status: 400 });
    }

    // Update status to cancelled
    const { error: updateError } = await supabase
      .from('workflow_executions')
      .update({ 
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: 'Cancelled by client request'
      })
      .eq('id', executionId);

    if (updateError) throw updateError;

    // TODO: Cancel Modal execution if running
    // await cancelModalExecution(execution.modal_call_id);

    return NextResponse.json({ 
      message: 'Execution cancelled successfully',
      execution_id: execution.id,
      status: 'cancelled'
    });

  } catch (error) {
    console.error('Error cancelling execution:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
