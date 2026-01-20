import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';



export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    // Fetch UI tree events directly from the database using the optimized view and indexed column.
    // This is much more efficient than fetching all events and filtering in memory.
    const { data: events, error: eventsError, count } = await getSupabaseAdmin()
      .from('low_level_events_enriched') // Use the enriched view
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .eq('event_type', 'ui_tree') // Filter in the database
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventsError) {
      console.error('Supabase error:', eventsError);
      return new Response(JSON.stringify({ error: eventsError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // The in-memory filtering logic below is no longer needed because the database
    // query is now precise. I will comment it out for clarity.
    /*
    const events = (allEvents || []).filter(event => {
      try {
        const payload = event.payload;
        return (
          payload?.event?.screen?.ui_tree ||
          payload?.payload?.event?.screen?.ui_tree
        );
      } catch {
        return false;
      }
    });
    */

    const hasMore = (count || 0) > limit;

    return NextResponse.json({
      events: events || [],
      hasMore,
      totalCount: count || 0,
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/ui-trees] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch ui_tree events', details: error.message }, { status: 500 });
  }
} 