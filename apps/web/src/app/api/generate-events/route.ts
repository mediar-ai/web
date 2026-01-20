import { NextResponse } from 'next/server';
import { generateMultiActivityEventAnalysis } from '@/lib/analysis';
import { EVENTS_PROMPT } from '@/lib/prompts';
import type { ActivityItem, Event } from '@/types';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// This function will be called periodically to generate events from recent activities.
export async function POST(request: Request) {
  try {
    const { sessionId, userId } = await request.json();

    if (!sessionId || !userId) {
      return NextResponse.json({ error: 'sessionId and userId are required' }, { status: 400 });
    }

    // 1. Fetch recent, unprocessed activity items for the session.
    const { data: activityData, error: activityError } = await getSupabaseAdmin()
      .from('user_activity_data')
      .select('*')
      .eq('session_id', sessionId)
      .eq('item_type', 'activity_item')
      .order('client_timestamp', { ascending: false })
      .limit(10); // Analyze the last 10 activities

    if (activityError) throw activityError;

    if (!activityData || activityData.length === 0) {
      return NextResponse.json({ message: 'No recent activities to process.' });
    }

    const activityItems = activityData.map(item => ({ ...item.item_data, id: item.client_item_id })) as ActivityItem[];
    const latestActivitySource = activityData[0].source || 'unknown';
    
    // Note: Previous events context was removed since new function doesn't use it
    
    // 3. Convert activities to summaries for the LLM prompt.
    const activitiesSummary = activityItems.map(item => ({
      type: item.type,
      timestamp: new Date(item.timestamp).toLocaleString(),
      change_detected: item.type === 'ui_diff' ? item.change_detected : undefined,
      change_description: item.type === 'ui_diff' ? item.change_description : undefined,
      content_preview: item.type === 'initial_dump' ? item.raw_content?.slice(0, 200) : undefined,
    }));
    
    // 4. Call the analysis function.
    const analysis = await generateMultiActivityEventAnalysis(activitiesSummary, EVENTS_PROMPT);

    // 5. If it's a distinct event, save it to the database.
    if (analysis && analysis.is_distinct_event === 'yes') {
      const newEvent: Event = {
        id: `event-${Date.now()}`,
        summary: analysis.description,
        timestamp: new Date().toISOString(),
        activity_ids: activityItems.map(a => a.id),
      };

      await getSupabaseAdmin().from('user_activity_data').insert({
        session_id: sessionId,
        user_id: userId,
        item_type: 'event',
        client_item_id: newEvent.id,
        item_data: newEvent,
        client_timestamp: newEvent.timestamp,
        source: latestActivitySource, // Inherit source from the latest activity
      });
      
      return NextResponse.json({ message: 'New event generated and saved.', event: newEvent });
    }

    return NextResponse.json({ message: 'No new distinct event generated.' });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    console.error('[API/generate-events] Error:', errorMessage);
    return NextResponse.json({ error: 'Failed to generate events.', details: errorMessage }, { status: 500 });
  }
} 