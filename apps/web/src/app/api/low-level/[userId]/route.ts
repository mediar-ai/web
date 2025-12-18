import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Copying type from frontend for consistency. In a refactor, move to a shared types file.
interface LowLevelEvent {
  id: number;
  session_id: string;
  user_id: string;
  payload: Record<string, unknown>;
  created_at: string;
  is_counted?: boolean;
  source?: string;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
  const eventType = searchParams.get('eventType'); // New filter parameter
  const uiTreesOnly = searchParams.get('ui_trees_only') === 'true'; // UI trees only filter for Steps tab
  const afterTimestamp = searchParams.get('after_timestamp'); // New parameter for efficient polling
  const startDate = searchParams.get('startDate'); // Start date for period loading
  const endDate = searchParams.get('endDate'); // End date for period loading
  const requestedLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 300;
  let offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0;
  const SUPABASE_MAX_LIMIT = 1000;

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  console.log(`[API/low-level] Query for userId: ${userId}`);

  try {
    // user_id is now TEXT and stores Clerk IDs directly - query by user_id column
    let query = supabaseAdmin
      .from('low_level_events_enriched')
      .select('*')
      .eq('user_id', userId);

    // Add session filter if provided
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    // Add UI trees only filter (optimized for Steps tab)
    if (uiTreesOnly) {
      query = query.eq('event_type', 'ui_tree');
    } else if (eventType) {
      // Add event type filter if provided (and not using ui_trees_only)
      query = query.eq('event_type', eventType);
    }

    // Add timestamp filter for efficient polling (only get events after specified time)
    if (afterTimestamp) {
      query = query.gt('created_at', afterTimestamp);
    }

    // Add date range filter for period loading
    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    // --- New Looping Logic ---
    let allFetchedEvents: LowLevelEvent[] = [];
    let hasMoreData = true;
    let remainingLimit = requestedLimit;

    while (hasMoreData && remainingLimit > 0) {
      const currentLimit = Math.min(remainingLimit, SUPABASE_MAX_LIMIT);
      
      const { data: events, error: eventsError } = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + currentLimit - 1);
        
      if (eventsError) {
        console.error('[API/low-level] Error fetching raw events:', eventsError);
        throw eventsError;
      }

      if (events && events.length > 0) {
        allFetchedEvents = allFetchedEvents.concat(events);
        offset += events.length;
        remainingLimit -= events.length;
      } else {
        hasMoreData = false;
      }
      
      if (events.length < currentLimit) {
        hasMoreData = false;
      }
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

    // Get the total event count for the user from session_metadata
    const { data: totalCountData, error: totalCountError } = await supabaseAdmin
      .from('session_metadata')
      .select('event_count')
      .eq('user_id', userId);

    if (totalCountError) {
      console.error('[API/low-level] Error fetching total event count:', totalCountError);
      throw totalCountError;
    }
    const totalEventCount = totalCountData?.reduce((sum, row) => sum + (row.event_count || 0), 0) || 0;

    // Get the total number of UI tree events (steps)
    const { count: totalStepsCount, error: stepsCountError } = await supabaseAdmin
      .from('low_level_events_enriched')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('event_type', 'ui_tree');

    if (stepsCountError) {
      console.error('[API/low-level] Error fetching total steps count:', stepsCountError);
      throw stepsCountError;
    }

    return NextResponse.json({
        events: allFetchedEvents,
        totalEventCount,
        totalStepsCount: totalStepsCount || 0,
        sessionCount: sessionCountData,
        hasMore: hasMoreData,
        offset: offset,
        limit: requestedLimit
    });

  } catch (err) {
    const error = err as { message: string };
    console.error('[API/low-level] Critical error:', error);
    return NextResponse.json({ error: 'Failed to fetch raw events', details: error.message }, { status: 500 });
  }
} 