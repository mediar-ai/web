import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId: executionIdStr } = await params;
    const executionId = parseInt(executionIdStr);

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the execution to check its current status
    const { data: execution, error: fetchError } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (fetchError || !execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Only allow canceling if status is 'queued' or 'running'
    if (execution.status !== 'queued' && execution.status !== 'running') {
      return NextResponse.json(
        { error: `Cannot cancel execution with status: ${execution.status}` },
        { status: 400 }
      );
    }

    // Update the execution status to 'cancelled'
    const { data: updated, error: updateError } = await supabase
      .from('workflow_executions')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        result: {
          cancelled: true,
          cancelled_at: new Date().toISOString(),
          cancelled_reason: 'User requested cancellation',
          previous_status: execution.status
        }
      })
      .eq('id', executionId)
      .select()
      .single();

    if (updateError) {
      console.error('Error canceling execution:', updateError);
      return NextResponse.json(
        { error: 'Failed to cancel execution' },
        { status: 500 }
      );
    }

    // If it was running, we might need to notify the Modal executor to stop
    // This is a placeholder - actual implementation would depend on Modal's API
    if (execution.status === 'running' && execution.modal_task_id) {
      // TODO: Call Modal API to cancel the running task
      console.log(`Would cancel Modal task: ${execution.modal_task_id}`);
    }

    return NextResponse.json({
      success: true,
      execution: updated
    });

  } catch (error) {
    console.error('Error in cancel execution endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}