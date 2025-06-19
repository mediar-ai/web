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
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 1000;
  const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    // Build query with optional session filter and pagination
    let query = supabaseAdmin
      .from('low_level_events')
      .select('*')
      .eq('user_id', userId);

    // Add session filter if provided
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    // Add pagination and ordering - sort by actual event timestamp DESC to get most recent first
    query = query
      .order("payload->'payload'->>'timestamp'", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      console.error('[API/low-level] Error fetching raw events:', eventsError);
      throw eventsError;
    }

    // Only fetch session count if no specific session is requested
    let sessionCountData = 0;
    if (!sessionId) {
      const { data: countData, error: countError } = await supabaseAdmin
          .rpc('count_distinct_sessions', { p_user_id: userId });

      if (countError) {
          console.error('[API/low-level] Error counting sessions:', countError);
          throw countError;
      }
      sessionCountData = countData || 0;
    }

    return NextResponse.json({
        events: events || [],
        sessionCount: sessionCountData,
        hasMore: events?.length === limit,
        offset: offset,
        limit: limit
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/low-level] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch raw events', details: error.message }, { status: 500 });
  }
} 