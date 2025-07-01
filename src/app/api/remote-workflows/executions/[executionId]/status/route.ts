import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  // Redirect to unified endpoint
  const { executionId } = await params;
  return NextResponse.redirect(new URL(`/api/remote-workflows/executions/${executionId}`, request.url));
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
