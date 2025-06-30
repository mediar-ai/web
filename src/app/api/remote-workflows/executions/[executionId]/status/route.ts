import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
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
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        execution_params,
        error_message,
        queued_at,
        started_at,
        completed_at,
        execution_duration_seconds,
        modal_call_id,
        priority,
        workflow:deployed_workflows(
          id,
          name,
          estimated_duration_seconds
        )
      `)
      .eq('id', executionId)
      .single();

    if (error) throw error;
    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    // Calculate progress estimates
    const now = new Date();
    const queuedAt = new Date(execution.queued_at);
    const startedAt = execution.started_at ? new Date(execution.started_at) : null;
    const workflow = Array.isArray(execution.workflow) ? execution.workflow[0] : execution.workflow;
    
    let estimatedCompletion = null;
    let progressPercent = null;
    let elapsedSeconds = 0;

    if (execution.status === 'running' && startedAt) {
      elapsedSeconds = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
      const estimatedDuration = workflow?.estimated_duration_seconds || 120;
      progressPercent = Math.min(Math.floor((elapsedSeconds / estimatedDuration) * 100), 95);
      
      const remainingSeconds = Math.max(estimatedDuration - elapsedSeconds, 5);
      estimatedCompletion = new Date(now.getTime() + remainingSeconds * 1000);
    } else if (execution.status === 'queued') {
      const queuedSeconds = Math.floor((now.getTime() - queuedAt.getTime()) / 1000);
      elapsedSeconds = queuedSeconds;
      // Estimate queue wait time (could be based on queue length)
      estimatedCompletion = new Date(now.getTime() + 30000); // 30 seconds from now
    }

    const status = {
      execution_id: execution.id,
      workflow_id: execution.workflow_id,
      workflow_name: workflow?.name,
      status: execution.status,
      
      // Timing information
      queued_at: execution.queued_at,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      elapsed_seconds: elapsedSeconds,
      execution_duration_seconds: execution.execution_duration_seconds,
      estimated_completion: estimatedCompletion,
      progress_percent: progressPercent,
      
      // Queue and execution details
      priority: execution.priority,
      modal_call_id: execution.modal_call_id,
      
      // Error information (if failed)
      error_message: execution.error_message,
      
      // Available actions
      can_cancel: ['queued', 'running'].includes(execution.status),
      
      // URLs for additional data
      results_url: execution.status === 'completed' 
        ? `/api/remote-workflows/executions/${execution.id}/results` 
        : null,
      logs_url: `/api/remote-workflows/executions/${execution.id}/logs`
    };

    return NextResponse.json(status);

  } catch (error) {
    console.error('Error fetching execution status:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
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
