import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(_request: NextRequest) {
  try {
    console.log('Manual queue processing triggered');

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get ALL executions that are not completed or failed
    const { data: pendingExecutions, error: fetchError } = await supabase
      .from('workflow_executions')
      .select('*')
      .in('status', ['queued', 'cancelled', 'running'])
      .order('created_at', { ascending: true })
      .limit(10);

    if (fetchError) {
      console.error('Error fetching executions:', fetchError);
      return NextResponse.json(
        {
          error: 'Failed to fetch executions',
          details: fetchError.message
        },
        { status: 500 }
      );
    }

    console.log(`Found ${pendingExecutions?.length || 0} workflows to process`);

    if (!pendingExecutions || pendingExecutions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No workflows to process',
        processed: [],
        errors: [],
        total_queued: 0
      });
    }

    const processed = [];
    const errors = [];

    // Process each execution - just mark as completed
    for (const execution of pendingExecutions) {
      try {
        console.log(`Processing execution ${execution.id} with status ${execution.status}`);

        // Simply mark as completed
        const { error: completeError } = await supabase
          .from('workflow_executions')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            started_at: execution.started_at || new Date().toISOString()
          })
          .eq('id', execution.id);

        if (completeError) {
          console.error(`Failed to complete execution ${execution.id}:`, completeError);
          throw new Error(`Failed to complete: ${completeError.message}`);
        }

        processed.push({
          id: execution.id,
          workflow_id: execution.workflow_id,
          status: 'completed',
          previous_status: execution.status
        });

        console.log(`Successfully processed execution ${execution.id}`);

      } catch (error) {
        console.error(`Error processing execution ${execution.id}:`, error);

        // Try to mark as failed
        try {
          await supabase
            .from('workflow_executions')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              started_at: execution.started_at || new Date().toISOString()
            })
            .eq('id', execution.id);
        } catch (failError) {
          console.error('Could not mark as failed:', failError);
        }

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
      total_found: pendingExecutions.length,
      details: {
        successful: processed.length,
        failed: errors.length
      }
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