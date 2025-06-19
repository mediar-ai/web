import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeTextEvent, analyzeUIDiff, performInitialFrameDump, normalizeScreenshotData } from '@/lib/analysis';
import { EVENTS_PROMPT, UI_TREE_ANALYSIS_PROMPT } from '@/lib/prompts';
import { uploadImage } from '@/lib/storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Flexible screenshot discovery function
function findScreenshotsInPayload(payload: Record<string, unknown>): { before: string | null; after: string | null; discoveryLog: string[] } {
  const screenshots: Array<{ path: string; data: string; key: string; size: number }> = [];
  const log: string[] = [];
  
  function searchObject(obj: Record<string, unknown>, path = ''): void {
    if (!obj || typeof obj !== 'object') return;
    
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (typeof value === 'string' && value.startsWith('data:image/') && value.length > 100) {
        screenshots.push({
          path: currentPath,
          data: value,
          key: key.toLowerCase(),
          size: value.length
        });
        log.push(`Found screenshot at ${currentPath} (${value.length} bytes)`);
      } else if (typeof value === 'object' && value !== null) {
        searchObject(value as Record<string, unknown>, currentPath);
      }
    }
  }
  
  searchObject(payload);
  log.push(`Total screenshots found: ${screenshots.length}`);
  
  if (screenshots.length === 0) {
    return { before: null, after: null, discoveryLog: log };
  }
  
  // Classify screenshots as before/after
  let beforeScreenshot: string | null = null;
  let afterScreenshot: string | null = null;
  
  if (screenshots.length === 1) {
    // Single screenshot - treat as "after" (initial screenshot case)
    afterScreenshot = screenshots[0].data;
    log.push(`Single screenshot found, treating as 'after': ${screenshots[0].path}`);
  } else {
    // Multiple screenshots - try to identify before/after
    const beforeCandidates = screenshots.filter(s => 
      s.key.includes('before') || s.key.includes('prev') || s.key.includes('old') || 
      s.key.includes('1') || s.key.includes('first') || s.key.includes('initial')
    );
    
    const afterCandidates = screenshots.filter(s => 
      s.key.includes('after') || s.key.includes('next') || s.key.includes('current') || 
      s.key.includes('new') || s.key.includes('2') || s.key.includes('second') || s.key.includes('latest')
    );
    
    if (beforeCandidates.length > 0) {
      beforeScreenshot = beforeCandidates[0].data;
      log.push(`Before screenshot identified: ${beforeCandidates[0].path}`);
    }
    
    if (afterCandidates.length > 0) {
      afterScreenshot = afterCandidates[0].data;
      log.push(`After screenshot identified: ${afterCandidates[0].path}`);
    }
    
    // Fallback: if we couldn't classify, use first two screenshots
    if (!beforeScreenshot && !afterScreenshot && screenshots.length >= 2) {
      beforeScreenshot = screenshots[0].data;
      afterScreenshot = screenshots[1].data;
      log.push(`Fallback: Using first two screenshots - before: ${screenshots[0].path}, after: ${screenshots[1].path}`);
    } else if (!afterScreenshot && screenshots.length >= 1) {
      afterScreenshot = screenshots[0].data;
      log.push(`Fallback: Using first screenshot as 'after': ${screenshots[0].path}`);
    }
  }
  
  return { before: beforeScreenshot, after: afterScreenshot, discoveryLog: log };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    // --- Step 1 (New): Insert the raw, unmodified payload into low_level_events ---
    // Extract the actual event timestamp for proper ordering
    const eventTimestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();
    
    const { error: rawInsertError } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id,
        payload: body, // Save the entire request body in the payload column
        source: 'windows_app', // Add a source to distinguish from other potential low-level sources
        created_at: eventTimestamp // Use actual event timestamp for proper chronological ordering
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
        let screenshot_before = payload.event?.screenshot_diff?.before;
        let screenshot_after = payload.event?.screenshot_diff?.after;

        // Normalize empty strings to null to handle client-side inconsistencies
        let normalizedScreenshotBefore = normalizeScreenshotData(screenshot_before);
        let normalizedScreenshotAfter = normalizeScreenshotData(screenshot_after);
        
        // If primary method didn't find valid screenshots, try flexible discovery
        if (!normalizedScreenshotBefore && !normalizedScreenshotAfter) {
          console.log('[INGEST] Primary screenshot discovery failed, trying flexible search...');
          const { before, after, discoveryLog } = findScreenshotsInPayload(payload);
          
          // Log the discovery process
          discoveryLog.forEach(logEntry => console.log(`[FLEXIBLE_DISCOVERY] ${logEntry}`));
          
          if (before || after) {
            console.log('[INGEST] Flexible discovery found screenshots, using those instead');
            screenshot_before = before;
            screenshot_after = after;
            normalizedScreenshotBefore = normalizeScreenshotData(before);
            normalizedScreenshotAfter = normalizeScreenshotData(after);
          }
        }

        // Handle the edge case where the first screenshot is sent as a diff
        if (normalizedScreenshotAfter && !normalizedScreenshotBefore) {
            console.log('[INGEST] Handling initial screenshot as a meaningful_event...');
            
            // LOG THE ACTUAL DATA SIZE AND FORMAT
            console.log('[DEBUG] Screenshot data size:', normalizedScreenshotAfter.length);
            console.log('[DEBUG] Screenshot prefix:', normalizedScreenshotAfter.substring(0, 50));
            
            // Check size first (1MB limit)
            if (normalizedScreenshotAfter.length > 1000000) {
                console.log('[INGEST] Screenshot too large, skipping AI analysis');
                analysisResult = "Large initial screenshot captured (AI analysis skipped due to size)";
                activityType = 'initial_dump';
                break;
            }
            
            try {
                // This is the first screenshot, treat it like an initial dump for analysis
                const dumpStream = await performInitialFrameDump(normalizedScreenshotAfter);
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

        if (!normalizedScreenshotBefore || !normalizedScreenshotAfter) {
            console.log('[INGEST] Missing screenshots - before:', !!normalizedScreenshotBefore, 'after:', !!normalizedScreenshotAfter);
            console.log('[INGEST] Original values - before type:', typeof screenshot_before, 'after type:', typeof screenshot_after);
            return NextResponse.json({ 
                error: 'screenshot_before and screenshot_after are required for a standard screenshot_diff',
                debug: {
                    before_present: !!normalizedScreenshotBefore,
                    after_present: !!normalizedScreenshotAfter,
                    before_type: typeof screenshot_before,
                    after_type: typeof screenshot_after,
                    before_length: screenshot_before?.length || 0,
                    after_length: screenshot_after?.length || 0
                }
            }, { status: 400 });
        }
        
        // 1. Generate IDs for the screenshots
        const eventTimestamp = new Date(payload.timestamp).getTime(); // Use the original timestamp from the payload
        const sequenceId = `${session_id}-${eventTimestamp}`;
        const image1_id = `before-${sequenceId}`;
        const image2_id = `after-${sequenceId}`;

        // 2. Upload images to Supabase Storage
        try {
            await uploadImage(normalizedScreenshotBefore, `${user_id}/${session_id}/screenshots/${image1_id}.jpeg`);
            await uploadImage(normalizedScreenshotAfter, `${user_id}/${session_id}/screenshots/${image2_id}.jpeg`);
            console.log(`[INGEST] Successfully uploaded screenshots for diff: ${sequenceId}`);
        } catch (uploadError) {
            console.error('[INGEST] Screenshot upload failed:', uploadError);
            return NextResponse.json({ error: 'Failed to upload screenshots.' }, { status: 500 });
        }
        
        // 3. Perform the analysis
        const diffResult = await analyzeUIDiff(normalizedScreenshotBefore, normalizedScreenshotAfter, "");
        
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
