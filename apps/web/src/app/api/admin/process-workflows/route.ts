import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMediarAdmin } from '@/lib/auth/requireMediarAdmin';

export async function POST(_request: NextRequest) {
  try {
    const denied = await requireMediarAdmin();
    if (denied) return denied;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Just check the queue status - don't process anything
    // The actual processing is done by Modal's scheduled function
    const { data: queuedExecutions } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, created_at')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(10);

    if (!queuedExecutions || queuedExecutions.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No queued workflows',
        queue_count: 0
      });
    }

    // Return queue status without processing
    return NextResponse.json({
      success: true,
      message: `${queuedExecutions.length} workflows in queue (Modal will process them)`,
      queue_count: queuedExecutions.length,
      queued_ids: queuedExecutions.map(e => e.id),
      note: 'Workflows are processed automatically by Modal every second'
    });

  } catch (error) {
    console.error('Error processing workflows:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process workflows',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}