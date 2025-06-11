import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { ActivityItem, Event, RunningAnalysis } from '@/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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

export async function GET(
  request: Request,
  { params }: { params: { userId: string } }
) {
  const { userId } = params;
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
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

    // Base query
    let query = supabaseAdmin
      .from('user_activity_data')
      .select('item_type, item_data, client_item_id, client_timestamp')
      .eq('user_id', userId);

    // Filter by session ID if provided
    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }
    
    // Execute query
    const { data, error } = await query;
    
    if (error) {
      console.error(`[API/data] Initial query failed for user ${userId}. Full error:`, JSON.stringify(error, null, 2));
      throw error;
    }

    if (!data) {
      // If data is still null/undefined, return empty
      return NextResponse.json({
        userName: userData?.name || null,
        activityItems: [],
        events: [],
        completedAnalyses: [],
      }, { status: 200 });
    }
    
    // Process and segregate data
    const activityItems: ActivityItem[] = [];
    const events: Event[] = [];
    const completedAnalyses: RunningAnalysis[] = [];
    
    data.forEach(item => {
      const fullItem = {
        id: item.client_item_id,
        timestamp: item.client_timestamp,
        ...item.item_data as object,
      };

      switch (item.item_type) {
        case 'activity_item':
          activityItems.push(fullItem as ActivityItem);
          break;
        case 'event':
          events.push(fullItem as Event);
          break;
        case 'completed_analysis':
          if (isRunningAnalysis(fullItem)) {
            completedAnalyses.push(fullItem);
          } else {
            console.warn('[API/data] Received item with type "completed_analysis" that did not match RunningAnalysis shape:', fullItem);
          }
          break;
      }
    });

    // Sort by timestamp descending
    activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    completedAnalyses.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));

    return NextResponse.json({
      userName: userData?.name || null,
      activityItems,
      events,
      completedAnalyses,
      // workflowSteps can be added here if stored
    }, { status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error(`[API/data] Critical error for user ${userId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch user data', details: errorMessage }, { status: 500 });
  }
} 