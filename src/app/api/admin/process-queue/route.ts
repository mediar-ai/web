import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_request: NextRequest) {
  try {
    console.log('Manual queue processing triggered');

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all queued workflows
    const { data: queuedExecutions, error: fetchError } = await supabase
      .from('workflow_executions')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true });

    if (fetchError) {
      console.error('Error fetching queued executions:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch queued executions' },
        { status: 500 }
      );
    }

    const processed = [];
    const errors = [];

    // Process each queued execution
    for (const execution of queuedExecutions || []) {
      try {
        // Get the workflow
        const { data: workflow, error: workflowError } = await supabase
          .from('remote_workflows')
          .select('*')
          .eq('id', execution.workflow_id)
          .single();

        if (workflowError || !workflow) {
          throw new Error(`Workflow ${execution.workflow_id} not found`);
        }

        // Mark as running
        const { error: updateError } = await supabase
          .from('workflow_executions')
          .update({
            status: 'running',
            started_at: new Date().toISOString()
          })
          .eq('id', execution.id);

        if (updateError) {
          throw new Error(`Failed to update execution status: ${updateError.message}`);
        }

        // Simulate processing (in production, this would call the actual executor)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Mark as completed
        const { error: completeError } = await supabase
          .from('workflow_executions')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            output_data: {
              status: 'success',
              message: 'Workflow completed via manual trigger',
              processed_at: new Date().toISOString()
            }
          })
          .eq('id', execution.id);

        if (completeError) {
          throw new Error(`Failed to complete execution: ${completeError.message}`);
        }

        processed.push({
          id: execution.id,
          workflow_id: execution.workflow_id,
          status: 'completed'
        });

      } catch (error) {
        console.error(`Error processing execution ${execution.id}:`, error);

        // Mark as failed
        await supabase
          .from('workflow_executions')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', execution.id);

        errors.push({
          id: execution.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processed.length} executions`,
      processed,
      errors,
      total_queued: queuedExecutions?.length || 0
    });

  } catch (error) {
    console.error('Error in manual queue processing:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to check queue status
export async function GET(_request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: queuedCount, error: countError } = await supabase
      .from('workflow_executions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued');

    const { data: runningCount, error: runningError } = await supabase
      .from('workflow_executions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'running');

    return NextResponse.json({
      queued: countError ? 0 : (queuedCount?.length || 0),
      running: runningError ? 0 : (runningCount?.length || 0),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking queue status:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}