import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeTextEvent, analyzeUIDiff } from '@/lib/analysis';
import { EVENTS_PROMPT, UI_TREE_ANALYSIS_PROMPT } from '@/lib/prompts';
import { uploadImage } from '@/lib/storage';

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
          analysisResult = await analyzeTextEvent(uiTree, UI_TREE_ANALYSIS_PROMPT);
          activityType = 'initial_dump'; // This is a full state analysis
        } else {
          // Fallback if ui_tree is missing
          analysisResult = "Processed meaningful_event without a UI tree.";
        }
        break;

      case 'screenshot_diff':
        console.log('[INGEST] Processing screenshot_diff...');
        const { screenshot_before, screenshot_after } = payload.event || {};
        if (!screenshot_before || !screenshot_after) {
            return NextResponse.json({ error: 'screenshot_before and screenshot_after are required for screenshot_diff' }, { status: 400 });
        }
        
        // 1. Generate IDs for the screenshots
        const eventTimestamp = new Date(payload.timestamp).getTime(); // Use the original timestamp from the payload
        const sequenceId = `${session_id}-${eventTimestamp}`;
        const image1_id = `before-${sequenceId}`;
        const image2_id = `after-${sequenceId}`;

        // 2. Upload images to Supabase Storage
        try {
            await uploadImage(screenshot_before, `${user_id}/${session_id}/screenshots/${image1_id}.jpeg`);
            await uploadImage(screenshot_after, `${user_id}/${session_id}/screenshots/${image2_id}.jpeg`);
            console.log(`[INGEST] Successfully uploaded screenshots for diff: ${sequenceId}`);
        } catch (uploadError) {
            console.error('[INGEST] Screenshot upload failed:', uploadError);
            return NextResponse.json({ error: 'Failed to upload screenshots.' }, { status: 500 });
        }
        
        // 3. Perform the analysis
        const diffResult = await analyzeUIDiff(screenshot_before, screenshot_after, "");
        
        // 4. Prepare the results to be saved by the final, generic handler
        analysisResult = {
            type: 'ui_diff',
            change_detected: 'yes',
            change_description: diffResult.change_description || "Analyzed screenshot changes.",
            image1_id: image1_id,
            image2_id: image2_id,
            sequenceId: sequenceId,
        };
        activityType = 'ui_diff'; // Ensure the activity type is set correctly
        
        // No longer inserting here; will fall through to the generic handler.
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
      let itemData;

      if (activityType === 'initial_dump') {
        itemData = { type: 'initial_dump', raw_content: analysisResult };
      } else if (activityType === 'ui_diff') {
        // The analysisResult for ui_diff is now the full object.
        itemData = analysisResult;
      } else {
        itemData = { type: 'ui_diff', change_detected: 'yes', change_description: analysisResult };
      }

      await supabaseAdmin.from('user_activity_data').insert({
        session_id,
        user_id,
        item_type: 'activity_item',
        client_item_id: `llm-activity-${Date.now()}-${Math.random()}`,
        item_data: itemData,
        client_timestamp: new Date().toISOString(),
        source: 'low_level',
      });
      console.log(`[INGEST] Successfully saved analysis as ${activityType}.`);
    }

    return NextResponse.json({ success: true, message: 'Data ingested' });

  } catch (error) {
    let errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    // Check if it's a Google AI error and customize the message to be cleaner
    if (errorMessage.includes('GoogleGenerativeAI Error')) {
      const specificError = errorMessage.split('Base64 decoding failed')[0] || 'AI analysis failed';
      errorMessage = `[INGEST] ${specificError.trim()}`;
      console.error(errorMessage); // Log the clean message
    } else {
      console.error('[INGEST] Error processing request:', error);
    }
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 