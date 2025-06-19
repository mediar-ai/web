import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    // Perform two separate, efficient counts
    const [totalEventsResult, totalUiTreeEventsResult] = await Promise.all([
      supabaseAdmin
        .from('low_level_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('low_level_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('payload->payload->>type', 'ui_tree')
    ]);

    if (totalEventsResult.error) throw totalEventsResult.error;
    if (totalUiTreeEventsResult.error) throw totalUiTreeEventsResult.error;

    return NextResponse.json({
      totalEvents: totalEventsResult.count ?? 0,
      totalUiTreeEvents: totalUiTreeEventsResult.count ?? 0,
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/low-level/count] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch event counts', details: error.message }, { status: 500 });
  }
} 