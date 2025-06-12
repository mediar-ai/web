import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyzeTextEvent } from '@/lib/analysis';
import { EVENTS_PROMPT } from '@/lib/prompts';
import type { UIDiffAnalysis } from '@/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface ScreenshotPayload {
  id: string; // A unique ID for the screenshot, e.g., a timestamp or a UUID
  dataUrl: string; // The base64-encoded image data
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload, screenshots } = body;

    if (!session_id || !payload) {
      return NextResponse.json({ error: 'session_id and payload are required' }, { status: 400 });
    }

    const finalPayload = { ...payload };
    const successfulUploads: string[] = [];
    const failedUploads: { id: string; error: string }[] = [];

    if (screenshots && Array.isArray(screenshots) && screenshots.length > 0) {
      console.log(`[INGEST] Processing ${screenshots.length} screenshots for session ${session_id}...`);
      
      for (const ss of screenshots as ScreenshotPayload[]) {
        if (!ss.dataUrl || !ss.id) {
          console.warn('Skipping screenshot with missing dataUrl or id:', ss);
          failedUploads.push({ id: ss.id || 'unknown', error: 'Missing dataUrl or id' });
          continue;
        }

        const mimeTypeMatch = ss.dataUrl.match(/^data:(image\/[^;]+);base64,/);
        if (!mimeTypeMatch || !mimeTypeMatch[1]) {
          console.warn(`Invalid dataUrl format for screenshot ${ss.id}. Skipping.`);
          failedUploads.push({ id: ss.id, error: 'Invalid dataUrl format' });
          continue;
        }

        const mimeType = mimeTypeMatch[1];
        const base64Data = ss.dataUrl.substring(mimeTypeMatch[0].length);
        const fileExt = mimeType.split('/')[1] || 'bin';
        const imageBuffer = Buffer.from(base64Data, 'base64');
        const filePath = `${session_id}/${ss.id}.${fileExt}`;

        console.log(`[INGEST] Uploading low-level event screenshot: ${filePath} (Size: ${imageBuffer.length} bytes)`);
        
        const { error: uploadError } = await supabaseAdmin.storage
          .from('low-level-event-screenshots')
          .upload(filePath, imageBuffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (uploadError) {
          const errorMessage = uploadError.message;
          console.error(`[INGEST] Error uploading screenshot ${ss.id} for session ${session_id}:`, errorMessage);
          failedUploads.push({ id: ss.id, error: errorMessage });
        } else {
          console.log(`[INGEST] Successfully uploaded screenshot ${filePath}`);
          successfulUploads.push(filePath);
        }
      }
      
      if (successfulUploads.length > 0) {
        finalPayload.screenshot_paths = successfulUploads;
        console.log(`[INGEST] Added screenshot paths to payload:`, successfulUploads);
      } else {
        console.log('[INGEST] No screenshot paths were added to the payload as no uploads were successful.');
      }
    } else {
      console.log('[INGEST] No screenshots found in the request payload.');
    }

    console.log('[INGEST] Final payload before database insert:', JSON.stringify(finalPayload, null, 2));

    const { error: dbError } = await supabaseAdmin
      .from('low_level_events')
      .insert([{ session_id, user_id, payload: finalPayload }]);

    if (dbError) {
      console.error('Error inserting low-level event:', dbError);
      return NextResponse.json({ 
        message: 'Database insert failed',
        error: dbError.message,
        successfulUploads,
        failedUploads,
      }, { status: 500 });
    }

    // --- Start of New Analysis Logic ---
    try {
      // 1. Format the event payload into a human-readable string.
      // This is a simple version; it can be made more sophisticated.
      let eventForAnalysis = `Event Type: ${finalPayload.type}`;
      if (finalPayload.event) {
        eventForAnalysis += `, Details: ${JSON.stringify(finalPayload.event)}`;
      }
      if (finalPayload.screenshot_paths && finalPayload.screenshot_paths.length > 0) {
        eventForAnalysis += `, Screenshots: ${finalPayload.screenshot_paths.join(', ')}`;
      }

      // 2. Call the centralized analysis function.
      console.log(`[INGEST ANALYSIS] Analyzing event: "${eventForAnalysis}"`);
      const analysisResult = await analyzeTextEvent(eventForAnalysis, EVENTS_PROMPT);

      // 3. Log the result to the server console.
      console.log('--- LLM ANALYSIS RESULT (LOW-LEVEL EVENT) ---');
      console.log(analysisResult);
      console.log('---------------------------------------------');

      // 4. Save the analysis result to the user_activity_data table.
      if (analysisResult) {
        // The result from analyzeTextEvent is just a summary string.
        // We will create a UIDiffAnalysis-like object to store it.
        const newActivityItem: Omit<UIDiffAnalysis, 'id' | 'timestamp'> = {
          type: 'ui_diff', // All low-level events are treated as UI diffs for now
          change_detected: 'yes',
          change_description: analysisResult,
        };

        const { error: insertAnalysisError } = await supabaseAdmin
          .from('user_activity_data')
          .insert({
            session_id,
            user_id,
            item_type: 'activity_item', // Stored as an intermediate 'activity_item'
            client_item_id: `llm-activity-${Date.now()}-${Math.random()}`, // Create a unique ID
            item_data: newActivityItem,
            client_timestamp: new Date().toISOString(),
            source: 'low_level', // Set the source for low-level events
          });
        
        if (insertAnalysisError) {
          console.error('[INGEST ANALYSIS] Failed to save analysis to database:', insertAnalysisError);
        } else {
          console.log('[INGEST ANALYSIS] Successfully saved analysis to database as activity_item.');
        }
      }

    } catch (analysisError) {
      console.error('[INGEST ANALYSIS] Failed to analyze low-level event:', analysisError);
      // We don't return an error here because the main goal (ingestion) succeeded.
    }
    // --- End of New Analysis Logic ---

    // After all processing, trigger the metadata update
    try {
      const { error: rpcError } = await supabaseAdmin.rpc('update_session_metadata_from_all_events');
      if (rpcError) {
        console.error('[INGEST] Error triggering metadata update:', rpcError);
      }
    } catch (rpcError) {
      console.error('[INGEST] Critical error calling RPC:', rpcError);
    }

    const responseStatus = failedUploads.length > 0 ? 207 : 200; // 207 Multi-Status if partial success
    const responseMessage = failedUploads.length > 0 
      ? 'Event ingested with partial success' 
      : 'Event ingested successfully';

    return NextResponse.json({ 
      message: responseMessage,
      dbInsertSuccess: true,
      successfulUploads,
      failedUploads,
     }, { status: responseStatus });

  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
} 