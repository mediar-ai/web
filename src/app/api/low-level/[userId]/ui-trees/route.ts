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
    // Fetch UI tree events directly from the database using the optimized view and indexed column.
    // This is much more efficient than fetching all events and filtering in memory.
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('low_level_events_enriched') // Use the enriched view
      .select('*')
      .eq('user_id', userId)
      .eq('event_type', 'ui_tree') // Filter in the database
      .order('created_at', { ascending: false })
      .limit(50);

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

    return NextResponse.json({
      events: events || [],
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/ui-trees] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch ui_tree events', details: error.message }, { status: 500 });
  }
} 