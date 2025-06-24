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

    // Get the count of processed analyses
    const { count: processedCount, error: processedError } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (processedError) throw processedError;

    // Get the count of unprocessed UI tree events (new system)
    // Use the same logic as sequential processor to count unprocessed events
    const { data: unprocessedEvents, error: pendingError } = await supabaseAdmin
      .rpc('get_unprocessed_ui_tree_events', { p_user_id: userId });

    let pendingCount = 0;
    if (pendingError) {
      // Fallback: count manually if the function doesn't exist yet
      console.warn('get_unprocessed_ui_tree_events function not found, using fallback query');
      
      // Simplified fallback query - count UI tree events that don't have corresponding analyses
      const { data: allUiTreeEvents, error: uiTreeError } = await supabaseAdmin
        .from('low_level_events')
        .select('created_at')
        .eq('user_id', userId)
        .eq('payload->payload->type', 'ui_tree')
        .order('created_at', { ascending: true });

      if (uiTreeError) throw uiTreeError;

      const { data: allAnalyses, error: analysesError } = await supabaseAdmin
        .from('low_level_workflow_analyses')
        .select('client_timestamp')
        .eq('user_id', userId);

      if (analysesError) throw analysesError;

      // Count events without matching analyses
      const analysisTimestamps = new Set(allAnalyses?.map(a => a.client_timestamp) || []);
      const unprocessedCount = allUiTreeEvents?.filter(event => 
        !analysisTimestamps.has(event.created_at)
      ).length || 0;
      
      return NextResponse.json({
        processedCount: processedCount ?? 0,
        pendingCount: unprocessedCount,
      });
    } else {
      pendingCount = unprocessedEvents?.length || 0;
    }

    return NextResponse.json({
      processedCount: processedCount ?? 0,
      pendingCount: pendingCount,
    });

  } catch (error) {
    console.error('[workflow-status] Error fetching status:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 