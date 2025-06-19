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

    // Get the count of pending/in-progress jobs
    const { count: pendingCount, error: pendingError } = await supabaseAdmin
      .from('workflow_analysis_jobs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['pending', 'in_progress']);

    if (pendingError) throw pendingError;

    return NextResponse.json({
      processedCount: processedCount ?? 0,
      pendingCount: pendingCount ?? 0,
    });

  } catch (error) {
    console.error('[workflow-status] Error fetching status:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 