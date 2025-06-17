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
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('low_level_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (eventsError) {
      console.error('[API/low-level] Error fetching raw events:', eventsError);
      throw eventsError;
    }

    // New query to count distinct sessions
    const { data: sessionCountData, error: countError } = await supabaseAdmin
        .from('low_level_events')
        .select('session_id', { count: 'exact', head: true })
        .eq('user_id', userId);

    if (countError) {
        console.error('[API/low-level] Error counting sessions:', countError);
        throw countError;
    }

    return NextResponse.json({
        events: events || [],
        sessionCount: sessionCountData ? sessionCountData.length : 0 // The count is in the length of the data array with head:true
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/low-level] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch raw events', details: error.message }, { status: 500 });
  }
} 