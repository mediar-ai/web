import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { LowLevelEvent } from '@/types';
import { generateSimplifiedUiTreeString } from '@/lib/uiTreeUtils';
import { generateEventSummaryString } from '@/lib/eventSummarizer';

type ContextForAnalysis = {
    previousUiTree?: string | null;
    currentUiTree?: string | null;
    currentUiTree_structure?: string;
    eventsSincePreviousUiTreeByTimestamp?: string[];
};

const getEventTimestamp = (event: LowLevelEvent): string => {
  const payload = event.payload as { payload?: { timestamp?: string } };
  return payload?.payload?.timestamp || event.created_at;
};

async function runAnalysis(userId: string) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    // 1. Get all unprocessed events using our reliable SQL function
    const { data: unprocessedEvents, error: rpcError } = await supabase
        .rpc('get_unprocessed_ui_tree_events', { p_user_id: userId });

    if (rpcError) {
        console.error("Error fetching unprocessed events:", rpcError);
        throw new Error(`Failed to fetch unprocessed events: ${rpcError.message}`);
    }
    
    const unprocessedTypedEvents = (unprocessedEvents || []) as LowLevelEvent[];

    if (unprocessedTypedEvents.length === 0) {
        console.log(`[initiate-workflow-analysis] No unprocessed steps found for userId ${userId}.`);
        return;
    }

    console.log(`[initiate-workflow-analysis] Found ${unprocessedTypedEvents.length} unprocessed steps for userId ${userId}. Enqueuing jobs...`);

    // We still need all events to build context
    const { data: allEventsData, error: eventsError } = await supabase
        .from('low_level_events')
        .select('id, user_id, session_id, created_at, payload')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

    if (eventsError) throw new Error(`Failed to fetch all events for context: ${eventsError.message}`);
    const allEvents: LowLevelEvent[] = allEventsData || [];
    const uiTreeEvents: LowLevelEvent[] = allEvents.filter(e => (e.payload as { payload?: { type?: string } })?.payload?.type === 'ui_tree');

    // 2. Create a job for each unprocessed event
    const jobs = unprocessedTypedEvents.map((eventToProcess: LowLevelEvent) => {
        const context: ContextForAnalysis = {};
        
        const currentIndex = uiTreeEvents.findIndex(e => e.id === eventToProcess.id);
        const prevEvent = currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;

        const prevUiTreeString = prevEvent ? (prevEvent.payload as { payload?: { event?: { screen?: { ui_tree?: string } } } })?.payload?.event?.screen?.ui_tree : null;
        if (prevUiTreeString) {
            context.previousUiTree = generateSimplifiedUiTreeString(prevUiTreeString);
        }

        const currentUiTreeString = (eventToProcess.payload as { payload?: { event?: { screen?: { ui_tree?: string } } } })?.payload?.event?.screen?.ui_tree;
        if (currentUiTreeString) {
            context.currentUiTree_structure = "The UI tree is a simplified representation of the accessibility tree...";
            context.currentUiTree = generateSimplifiedUiTreeString(currentUiTreeString || "");
        }
        
        const prevEventTimestamp = prevEvent ? new Date(getEventTimestamp(prevEvent)).getTime() : 0;
        const currentEventTimestamp = new Date(getEventTimestamp(eventToProcess)).getTime();
        
        const relevantRawEvents = allEvents.filter((e: LowLevelEvent) => {
            const eventTime = new Date(getEventTimestamp(e)).getTime();
            return eventTime > prevEventTimestamp && eventTime < currentEventTimestamp;
        });

        if (relevantRawEvents.length > 0) {
            context.eventsSincePreviousUiTreeByTimestamp = relevantRawEvents.map((e: LowLevelEvent) => generateEventSummaryString(e));
        }
        
        return {
            user_id: userId,
            event_id: eventToProcess.id,
            payload: {
                context,
                event: {
                    session_id: eventToProcess.session_id,
                    created_at: eventToProcess.created_at,
                }
            }
        };
    });

    const { error: insertError } = await supabase.from('workflow_analysis_jobs').insert(jobs);

    if (insertError) {
        console.error("Error inserting jobs:", insertError);
        throw new Error(`Failed to enqueue jobs: ${insertError.message}`);
    }

    // 3. Trigger a single worker to start the sequential processing chain.
    const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const triggerUrl = `${host}/api/process-workflow-job`;
    
    console.log(`[initiate-workflow-analysis] Triggering a single worker at ${triggerUrl} to start the chain.`);
    
    // Fire and forget. We don't need to wait for the whole chain to complete.
    fetch(triggerUrl, { method: 'POST' })
        .catch(e => console.error("Error triggering worker:", e));

    console.log(`[initiate-workflow-analysis] Enqueued ${jobs.length} jobs and started the processing chain.`);
}

export async function POST(req: NextRequest) {
    try {
        const { userId } = await req.json();

        if (!userId) {
            return NextResponse.json({ error: 'userId is required' }, { status: 400 });
        }

        runAnalysis(userId).catch(err => {
            console.error(`[initiate-workflow-analysis] Uncaught exception in background job for userId ${userId}:`, err);
        });

        return NextResponse.json({ message: 'Workflow analysis initiated.' }, { status: 202 });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error('[initiate-workflow-analysis] API Route Error:', errorMessage);
        return NextResponse.json({ error: 'Failed to initiate workflow analysis.' }, { status: 500 });
    }
} 