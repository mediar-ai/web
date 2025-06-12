import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeTextEvent, analyzeUIDiff } from '@/lib/analysis';
import { EVENTS_PROMPT, TEXT_EXTRACTION_PROMPT } from '@/lib/prompts';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    // --- Start Router Logic ---
    let analysisResult;
    let activityType: 'initial_dump' | 'ui_diff' = 'ui_diff'; // Default to ui_diff

    switch (payload.type) {
      case 'meaningful_event':
        console.log('[INGEST] Processing meaningful_event with UI Tree...');
        if (payload.event?.screen?.ui_tree) {
          // If there's a ui_tree, analyze it directly for a detailed dump.
          const uiTree = payload.event.screen.ui_tree;
          analysisResult = await analyzeTextEvent(uiTree, TEXT_EXTRACTION_PROMPT);
          activityType = 'initial_dump'; // This is a full state analysis
        } else {
          // Fallback if ui_tree is missing
          analysisResult = "Processed meaningful_event without a UI tree.";
        }
        break;

      case 'screenshot_diff':
        console.log('[INGEST] Processing screenshot_diff...');
        const { screenshot_before, screenshot_after } = payload.event || {};
        if (screenshot_before && screenshot_after) {
            const diffResult = await analyzeUIDiff(screenshot_before, screenshot_after, "");
            analysisResult = diffResult.change_description || "Analyzed screenshot changes.";
        } else {
            return NextResponse.json({ error: 'screenshot_before and screenshot_after are required for screenshot_diff' }, { status: 400 });
        }
        break;

      default: // Handles simple low-level events (mouse_click, key_press, etc.)
        console.log(`[INGEST] Processing simple event: ${payload.type}`);
        let eventDetails = `Event Type: ${payload.type}`;
        if (payload.event) {
          eventDetails += `, Details: ${JSON.stringify(payload.event)}`;
        }
        analysisResult = await analyzeTextEvent(eventDetails, EVENTS_PROMPT);
        break;
    }
    // --- End Router Logic ---

    // Save the analysis result as an activity_item
    if (analysisResult) {
      const newActivityItemData = activityType === 'initial_dump' 
        ? { type: 'initial_dump', raw_content: analysisResult }
        : { type: 'ui_diff', change_detected: 'yes', change_description: analysisResult };

      await supabaseAdmin.from('user_activity_data').insert({
        session_id,
        user_id,
        item_type: 'activity_item',
        client_item_id: `llm-activity-${Date.now()}-${Math.random()}`,
        item_data: newActivityItemData,
        client_timestamp: new Date().toISOString(),
        source: 'low_level',
      });
      console.log(`[INGEST] Successfully saved analysis as ${activityType}.`);
    }

    // Trigger metadata update
    const { error: rpcError } = await supabaseAdmin.rpc('update_session_metadata_from_all_events');
    if (rpcError) {
      console.error('[INGEST] Error triggering metadata update:', rpcError);
    }

    return NextResponse.json({ message: 'Event processed successfully.' });

  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 