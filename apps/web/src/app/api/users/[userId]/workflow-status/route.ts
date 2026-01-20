import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Use timestamp matching logic (same as sequential processor) for accurate counts.
    // This eliminates the discrepancy between admin dashboard and processing reality.

    // Get unprocessed count using sequential processor's timestamp matching logic
    const { data: unprocessedCount, error: unprocessedError } = await supabaseAdmin
      .rpc('count_unprocessed_events_by_timestamp', { p_user_id: userId });

    if (unprocessedError) {
      console.error('[workflow-status] Error fetching unprocessed count:', unprocessedError);
      throw unprocessedError;
    }

    // Get processed count using timestamp matching logic
    const { data: processedCount, error: processedError } = await supabaseAdmin
      .rpc('count_processed_events_by_timestamp', { p_user_id: userId });

    if (processedError) {
      console.error('[workflow-status] Error fetching processed count:', processedError);
      throw processedError;
    }

    const finalProcessed = processedCount || 0;
    const pendingCount = unprocessedCount || 0;

    return NextResponse.json({
      processedCount: finalProcessed,
      pendingCount: pendingCount,
    });

  } catch (error) {
    console.error('[workflow-status] Error fetching status:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 