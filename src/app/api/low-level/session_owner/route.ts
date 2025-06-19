import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID is required' }, { status: 400 });
  }

  try {
    const { data: events, error: eventsError } = await supabaseAdmin
      .from('low_level_events')
      .select('*')
      .eq('session_id', sessionId)
      .order("payload->'payload'->>'timestamp'", { ascending: false })
      .limit(1000); // Reasonable limit for session view - most recent first

    if (eventsError) {
      console.error('[API/session_owner] Error fetching session events:', eventsError);
      throw eventsError;
    }

    return NextResponse.json({
        events: events || []
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/session_owner] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch session events', details: error.message }, { status: 500 });
  }
} 