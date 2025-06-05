// supabase/functions/ingest-data/index.ts

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2' // Ensure you use a Deno compatible import
import { corsHeaders } from '../_shared/cors.ts' // For CORS, if calling from browser directly

// Define the expected structure of the incoming payload's exportedData
// These should MATCH the structures you have in your frontend (page.tsx)

interface ScreenshotForExport {
  id: string; // client_item_id for 'screenshot_metadata'
  dataUrl: string; // Base64 encoded image data
  timestamp: number; // Epoch milliseconds from client
  size: number; // Size of the blob/file from client
  // Add any other fields from your frontend BufferedFrame that are relevant for metadata, e.g., percentChange
  percentChange?: number; 
}

interface ParsedAnalysis { 
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
}

interface WorkflowStep { 
  id: string; // client_item_id for 'workflow_step'
  analysis: string;
  parsed: ParsedAnalysis | null;
  timestamp: string; // ISO string from client
}

// Assuming frontendLogs are an array of objects with a message and original client timestamp
interface FrontendLogEntry { 
  message: string;
  timestamp: number; // Epoch milliseconds from client
  // index?: number; // if you had a specific index from the client
}

interface Event { 
  id: string; // client_item_id for 'event'
  summary: string;
  thoughts?: string;
  timestamp: string; // ISO string from client
}

interface InitialFrameDumpAnalysis {
  type: 'initial_dump'; // This will be the item_type
  id: string; // client_item_id for 'initial_dump'
  timestamp: string; // ISO string from client, used for client_timestamp
  raw_content: string;
  image_id: string; // This could be part of item_data
  // Any other fields from your frontend type
}

interface UIDiffAnalysis {
  type: 'ui_diff'; // This will be the item_type
  id: string; // client_item_id for 'ui_diff'
  timestamp: string; // ISO string from client, used for client_timestamp
  change_detected: "yes" | "no";
  change_description?: string;
  identified_change_types?: string[];
  mouse_movement_details?: {
    from_object?: string;
    from_coordinate?: string;
    to_object?: string;
    to_coordinate?: string;
  };
  typing_details?: string;
  click_details?: string;
  new_window_details?: {
    old_window_name?: string;
    new_window_name?: string;
  };
  new_app_details?: string;
  scroll_details?: {
    new_content_summary?: string;
  };
  other_change_details?: Array<{
    type_description?: string;
    details?: string;
  }>;
  unidentified_changes_explanation?: string;
  new_content_detected?: string;
  image1_id?: string; // These image_ids would go into item_data
  image2_id?: string;
  // Any other fields from your frontend type
}

// This type represents the items in the activityItems array from your frontend
type ActivityItemFromFrontend = InitialFrameDumpAnalysis | UIDiffAnalysis;


interface ExportedDataFromClient { // Matches the structure from your frontend's getAllPersistedDataForExport
  workflowSteps: WorkflowStep[];
  frontendLogs: FrontendLogEntry[]; // Changed from string[] to match your original frontend structure more likely
  events: Event[];
  screenshots: ScreenshotForExport[]; // This is an array of screenshot data including base64
  activityItems: ActivityItemFromFrontend[];
  // exportedAt: string; // Client included this, can be stored if needed
}

interface RequestPayload {
  sessionId: string;
  exportedData: ExportedDataFromClient;
}

interface UserActivityDataRow { // Structure for inserting into your Supabase table
  session_id: string;
  item_type: string;
  client_item_id: string;
  item_data: Record<string, any>; 
  client_timestamp: string; // ISO string for TIMESTAMPTZ column
}


serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log("Edge Function 'ingest-data' invoked.");

  try {
    const payload = await req.json() as RequestPayload;
    const { sessionId, exportedData } = payload;

    if (!sessionId || typeof sessionId !== 'string') {
      console.error("Missing or invalid sessionId.");
      return new Response(JSON.stringify({ error: 'Missing or invalid sessionId' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }
    if (!exportedData) {
      console.error("Missing exportedData.");
      return new Response(JSON.stringify({ error: 'Missing exportedData' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }
    
    console.log(`Processing data for session ID: ${sessionId}. Received ${Object.keys(exportedData).length} data categories.`);

    // Initialize Supabase client with the SERVICE_ROLE_KEY
    const supabaseAdmin = createClient(
      Deno.env.get('PROJECT_URL') ?? '',
      Deno.env.get('SERVICE_KEY') ?? ''
    );

    const dataToUpsert: UserActivityDataRow[] = [];

    // 1. Process Screenshots
    if (exportedData.screenshots && Array.isArray(exportedData.screenshots)) {
      console.log(`Processing ${exportedData.screenshots.length} screenshots...`);
      for (const ss of exportedData.screenshots) {
        try {
          if (!ss.dataUrl || !ss.id || typeof ss.timestamp !== 'number') {
            console.warn("Skipping screenshot with missing dataUrl, id, or timestamp:", ss);
            continue;
          }
          const MimeTypeMatch = ss.dataUrl.match(/^data:(image\/[^;]+);base64,/);
          if (!MimeTypeMatch || !MimeTypeMatch[1]) {
              console.warn(`Invalid dataUrl format for screenshot ${ss.id}. Skipping.`);
              continue;
          }
          const MimeType = MimeTypeMatch[1];
          const base64Data = ss.dataUrl.substring(MimeTypeMatch[0].length);
          const fileExt = MimeType.split('/')[1] || 'bin';

          const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
          const filePath = `${sessionId}/${ss.id}.${fileExt}`;

          console.log(`Uploading screenshot: ${filePath} (Size: ${imageBuffer.length} bytes)`);
          const { error: uploadError } = await supabaseAdmin.storage
            .from('exported-screenshots') // YOUR BUCKET NAME - MAKE SURE THIS IS CORRECT
            .upload(filePath, imageBuffer, {
              contentType: MimeType,
              upsert: true,
            });

          if (uploadError) {
            console.error(`Error uploading screenshot ${ss.id} for session ${sessionId}:`, uploadError.message);
          } else {
            console.log(`Successfully uploaded screenshot ${filePath}`);
            const { dataUrl, ...metadata } = ss; // Exclude dataUrl from item_data
            dataToUpsert.push({
              session_id: sessionId,
              item_type: 'screenshot_metadata',
              client_item_id: ss.id,
              item_data: {
                storage_path: filePath,
                ...metadata // Store other fields like original size, percentChange etc.
              },
              client_timestamp: new Date(ss.timestamp).toISOString(),
            });
          }
        } catch (e) {
            let errorMessage = 'Unknown error processing screenshot.';
            if (e instanceof Error) {
                errorMessage = e.message;
            }
            console.error(`Critical error processing screenshot ${ss.id}: ${errorMessage}`, (e instanceof Error) ? e.stack : undefined);
        }
      }
    } else {
      console.log("No screenshots array found or it's not an array.");
    }

    // 2. Process Workflow Steps
    if (exportedData.workflowSteps && Array.isArray(exportedData.workflowSteps)) {
      console.log(`Processing ${exportedData.workflowSteps.length} workflow steps...`);
      for (const step of exportedData.workflowSteps) {
        if (!step.id || !step.timestamp) { console.warn("Skipping workflow step with missing id/timestamp:", step); continue;}
        dataToUpsert.push({
          session_id: sessionId,
          item_type: 'workflow_step',
          client_item_id: step.id,
          item_data: { analysis: step.analysis, parsed: step.parsed },
          client_timestamp: step.timestamp,
        });
      }
    }

    // 3. Process Frontend Logs
    if (exportedData.frontendLogs && Array.isArray(exportedData.frontendLogs)) {
      console.log(`Processing ${exportedData.frontendLogs.length} frontend logs...`);
      exportedData.frontendLogs.forEach((log, index) => {
        if (!log || typeof log.message !== 'string' || typeof log.timestamp !== 'number') {
          console.warn("Skipping invalid log entry:", log);
          return;
        }
        const clientLogId = `log-${new Date(log.timestamp).toISOString()}-${index}`; // Ensure uniqueness
        dataToUpsert.push({
          session_id: sessionId,
          item_type: 'frontend_log',
          client_item_id: clientLogId,
          item_data: { message: log.message }, // Only store the message in item_data for this example
          client_timestamp: new Date(log.timestamp).toISOString(),
        });
      });
    }

    // 4. Process Events
    if (exportedData.events && Array.isArray(exportedData.events)) {
      console.log(`Processing ${exportedData.events.length} events...`);
      for (const event of exportedData.events) {
        if (!event.id || !event.timestamp) { console.warn("Skipping event with missing id/timestamp:", event); continue;}
        dataToUpsert.push({
          session_id: sessionId,
          item_type: 'event',
          client_item_id: event.id,
          item_data: { summary: event.summary, thoughts: event.thoughts },
          client_timestamp: event.timestamp,
        });
      }
    }

    // 5. Process Activity Items (Initial Dumps and UI Diffs)
    if (exportedData.activityItems && Array.isArray(exportedData.activityItems)) {
      console.log(`Processing ${exportedData.activityItems.length} activity items...`);
      for (const activity of exportedData.activityItems) {
        if (!activity.id || !activity.type || !activity.timestamp) { console.warn("Skipping activity item with missing id/type/timestamp:", activity); continue; }
        const { type, id, timestamp, ...itemSpecificData } = activity;
        dataToUpsert.push({
          session_id: sessionId,
          item_type: type,
          client_item_id: id,
          item_data: itemSpecificData,
          client_timestamp: timestamp,
        });
      }
    }
    
    // Batch Upsert to the database
    if (dataToUpsert.length > 0) {
      console.log(`Attempting to upsert ${dataToUpsert.length} items to user_activity_data table...`);
      // Log a few items to see their structure, especially timestamps
      if (dataToUpsert.length > 0) {
        console.log("Sample items for upsert (first 3):");
        for (let i = 0; i < Math.min(dataToUpsert.length, 3); i++) {
          console.log(JSON.stringify(dataToUpsert[i], null, 2));
        }
      }

      const { error: dbError, data: dbData } = await supabaseAdmin
        .from('user_activity_data')
        .upsert(dataToUpsert, {
          onConflict: 'session_id, item_type, client_item_id',
        });

      if (dbError) {
        console.error('Database error during upsert:', dbError.message, JSON.stringify(dbError, null, 2));
        // Add more details if possible to identify the problematic row(s)
        if (dbError.message && dbError.message.includes("timestamp")) {
          console.error("Potential problematic timestamp found. Review client_timestamp fields in the data being upserted.");
          // Try to find which item might have caused it (this is a bit rudimentary)
          for (const item of dataToUpsert) {
            try {
              new Date(item.client_timestamp).toISOString(); // Test if it parses and converts
            } catch (_) {
              console.error(`Potentially bad timestamp in item: client_item_id=${item.client_item_id}, item_type=${item.item_type}, client_timestamp='${item.client_timestamp}'`);
            }
          }
        }
        return new Response(JSON.stringify({ error: 'Database upsert failed', details: dbError.message }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        });
      }
      console.log(`${dataToUpsert.length} items successfully processed for upsert. Response from DB:`, dbData);
    } else {
      console.log("No data prepared to upsert.");
    }

    return new Response(JSON.stringify({ message: 'Data processing initiated', itemsAttempted: dataToUpsert.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    let errorMessage = 'An unexpected error occurred in the Edge Function';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    console.error('Critical error in Edge Function:', errorMessage, (error instanceof Error) ? error.stack : undefined);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})