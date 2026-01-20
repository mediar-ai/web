import { NextRequest, NextResponse } from 'next/server';
import type { ActivityItem, Event, RunningAnalysis } from '@/types';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic'; // Prevent caching

function isRunningAnalysis(item: unknown): item is RunningAnalysis {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const r = item as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.type === 'string' &&
    typeof r.status === 'string' &&
    typeof r.payloadType === 'string'
  );
}

const ACTIVITY_PAGE_SIZE = 1000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = parseInt(searchParams.get('limit') || String(ACTIVITY_PAGE_SIZE), 10);

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Fetch user's name
    const { data: userData, error: userError } = await supabaseAdmin
      .from('mediar_users')
      .select('name')
      .eq('user_id', userId)
      .single();

    if (userError && userError.code !== 'PGRST116') { // Ignore 'not found' error
      console.error(`[API/data] Error fetching user name for ${userId}:`, JSON.stringify(userError, null, 2));
      throw userError;
    }

    // Build base filter for activity items
    const activityTypes = ['activity_item', 'ui_diff', 'initial_dump'];

    // Query for activity items with pagination
    let activityQuery = supabaseAdmin
      .from('user_activity_data')
      .select('item_type, item_data, client_item_id, client_timestamp, user_id, session_id')
      .eq('user_id', userId)
      .in('item_type', activityTypes)
      .order('client_timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sessionId) {
      activityQuery = activityQuery.eq('session_id', sessionId);
    }

    // Query for events (no pagination - typically fewer)
    let eventsQuery = supabaseAdmin
      .from('user_activity_data')
      .select('item_type, item_data, client_item_id, client_timestamp')
      .eq('user_id', userId)
      .eq('item_type', 'event')
      .order('client_timestamp', { ascending: false });

    if (sessionId) {
      eventsQuery = eventsQuery.eq('session_id', sessionId);
    }

    // Query for completed analyses (no pagination - typically fewer)
    let analysesQuery = supabaseAdmin
      .from('user_activity_data')
      .select('item_type, item_data, client_item_id, client_timestamp')
      .eq('user_id', userId)
      .eq('item_type', 'completed_analysis')
      .order('client_timestamp', { ascending: false });

    if (sessionId) {
      analysesQuery = analysesQuery.eq('session_id', sessionId);
    }

    // Count total activity items for pagination info
    let countQuery = supabaseAdmin
      .from('user_activity_data')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('item_type', activityTypes);

    if (sessionId) {
      countQuery = countQuery.eq('session_id', sessionId);
    }

    // Execute all queries in parallel
    const [activityResult, eventsResult, analysesResult, countResult] = await Promise.all([
      activityQuery,
      eventsQuery,
      analysesQuery,
      countQuery,
    ]);

    // Debug logging to understand limits
    console.log(`[API/data] Query params: userId=${userId}, sessionId=${sessionId}, offset=${offset}, limit=${limit}`);
    console.log(`[API/data] Activity raw count: ${activityResult.data?.length}, Events raw count: ${eventsResult.data?.length}, Analyses raw count: ${analysesResult.data?.length}`);
    console.log(`[API/data] Total activity count from DB: ${countResult.count}`);

    if (activityResult.error) {
      console.error(`[API/data] Activity query failed for user ${userId}:`, JSON.stringify(activityResult.error, null, 2));
      throw activityResult.error;
    }

    if (eventsResult.error) {
      console.error(`[API/data] Events query failed for user ${userId}:`, JSON.stringify(eventsResult.error, null, 2));
      throw eventsResult.error;
    }

    if (analysesResult.error) {
      console.error(`[API/data] Analyses query failed for user ${userId}:`, JSON.stringify(analysesResult.error, null, 2));
      throw analysesResult.error;
    }

    // Process activity items
    const activityItems: ActivityItem[] = (activityResult.data || []).map((item) => ({
      id: item.client_item_id,
      timestamp: item.client_timestamp,
      ...item.item_data as object,
      user_id: item.user_id,
      session_id: item.session_id,
    } as ActivityItem));

    // Process events
    const events: Event[] = (eventsResult.data || []).map((item) => ({
      id: item.client_item_id,
      timestamp: item.client_timestamp,
      ...item.item_data as object,
    } as Event));

    // Process completed analyses
    const completedAnalyses: RunningAnalysis[] = [];
    (analysesResult.data || []).forEach((item) => {
      const baseItem = {
        id: item.client_item_id,
        timestamp: item.client_timestamp,
        ...item.item_data as object,
      };
      if (isRunningAnalysis(baseItem)) {
        completedAnalyses.push(baseItem);
      }
    });

    // Sort completed analyses by endTime
    completedAnalyses.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));

    const totalActivityItems = countResult.count || 0;
    const hasMore = offset + activityItems.length < totalActivityItems;

    return NextResponse.json({
      userName: userData?.name || null,
      activityItems,
      events,
      completedAnalyses,
      pagination: {
        offset,
        limit,
        total: totalActivityItems,
        hasMore,
      },
    }, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error(`[API/data] Critical error for user ${userId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch user data', details: errorMessage }, { status: 500 });
  }
}