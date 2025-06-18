import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeTextEvent, analyzeUIDiff, performInitialFrameDump } from '@/lib/analysis';
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

    // --- Step 1 (New): Insert the raw, unmodified payload into low_level_events ---
    const { error: rawInsertError } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id,
        payload: body, // Save the entire request body in the payload column
        source: 'windows_app' // Add a source to distinguish from other potential low-level sources
      });

    if (rawInsertError) {
      console.error('[INGEST] Error saving raw event:', rawInsertError);
      return NextResponse.json({ error: 'Failed to save raw event.', details: rawInsertError.message }, { status: 500 });
    }

    // --- Step 2 (Existing): Continue with AI analysis and processing ---
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
        const screenshot_before = payload.event?.screenshot_diff?.before;
        const screenshot_after = payload.event?.screenshot_diff?.after;

        // Handle the edge case where the first screenshot is sent as a diff
        if (screenshot_after && !screenshot_before) {
            console.log('[INGEST] Handling initial screenshot as a meaningful_event...');
            
            // LOG THE ACTUAL DATA SIZE AND FORMAT
            console.log('[DEBUG] Screenshot data size:', screenshot_after.length);
            console.log('[DEBUG] Screenshot prefix:', screenshot_after.substring(0, 50));
            
            // Check size first (1MB limit)
            if (screenshot_after.length > 1000000) {
                console.log('[INGEST] Screenshot too large, skipping AI analysis');
                analysisResult = "Large initial screenshot captured (AI analysis skipped due to size)";
                activityType = 'initial_dump';
                break;
            }
            
            try {
                // This is the first screenshot, treat it like an initial dump for analysis
                const dumpStream = await performInitialFrameDump(screenshot_after);
                // We need to read the stream to get the string content
                const reader = dumpStream.getReader();
                const decoder = new TextDecoder();
                let dumpText = '';
                let done = false;
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) {
                        dumpText += decoder.decode(value, { stream: true });
                    }
                }
                analysisResult = dumpText;
                activityType = 'initial_dump';
            } catch (error) {
                console.error('[ERROR] performInitialFrameDump failed:', error);
                // Handle the error gracefully instead of crashing
                analysisResult = "Initial screenshot captured (AI analysis failed: " + (error instanceof Error ? error.message : 'Unknown error') + ")";
                activityType = 'initial_dump';
            }
            break; // Exit the switch, fall through to the generic saver
        }

        if (!screenshot_before || !screenshot_after) {
            return NextResponse.json({ error: 'screenshot_before and screenshot_after are required for a standard screenshot_diff' }, { status: 400 });
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
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    const statusCode = 500;
    
    // Check if it's a Google AI error and provide more specific error information
    if (errorMessage.includes('GoogleGenerativeAI Error') || errorMessage.includes('Base64 decoding failed')) {
      console.error('[ERROR] AI analysis failed:', error);
      return NextResponse.json({ 
        error: 'AI analysis failed', 
        details: errorMessage,
        type: 'ai_analysis_error'
      }, { status: 500 });
    }
    
    // Check for initial frame dump specific errors
    if (errorMessage.includes('Malformed base64 image data')) {
      console.error('[ERROR] Image format error:', error);
      return NextResponse.json({ 
        error: 'Invalid image format', 
        details: errorMessage,
        type: 'image_format_error'
      }, { status: 400 });
    }
    
    // Check for upload errors
    if (errorMessage.includes('upload') || errorMessage.includes('storage')) {
      console.error('[ERROR] Storage error:', error);
      return NextResponse.json({ 
        error: 'Storage operation failed', 
        details: errorMessage,
        type: 'storage_error'
      }, { status: 500 });
    }
    
    // Generic error handling
    console.error('[INGEST] Error processing request:', error);
    return NextResponse.json({ 
      error: 'Failed to process request', 
      details: errorMessage,
      type: 'generic_error'
    }, { status: statusCode });
  }
}
