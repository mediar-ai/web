import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // A single, efficient query to count processed and pending UI tree events.
    // This is the most reliable method, replacing the previous complex fallbacks.

    // First, get the total count of UI tree events for this user.
    const { count: totalUiTrees, error: totalError } = await supabaseAdmin
      .from('low_level_events_enriched')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type', 'ui_tree');

    if (totalError) {
      console.error('[workflow-status] Error fetching total UI tree count:', totalError);
      throw totalError;
    }

    // Next, get the count of analyses, which represents the processed events.
    const { count: processedCount, error: processedError } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (processedError) {
      console.error('[workflow-status] Error fetching processed count:', processedError);
      throw processedError;
    }

    const finalTotal = totalUiTrees || 0;
    const finalProcessed = processedCount || 0;
    const pendingCount = finalTotal > finalProcessed ? finalTotal - finalProcessed : 0;

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