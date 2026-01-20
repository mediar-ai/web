import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// These types are copied from the old edge function for consistency.
// In a larger refactor, they could be moved to a shared types file.
interface ScreenshotForExport {
  id: string;
  dataUrl: string;
  timestamp: number;
  size: number;
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
  id: string;
  analysis: string;
  parsed: ParsedAnalysis | null;
  timestamp: string;
}

interface FrontendLogEntry {
  message: string;
  timestamp: number;
}

interface Event {
  id: string;
  summary: string;
  thoughts?: string;
  timestamp: string;
}

interface InitialFrameDumpAnalysis {
  type: 'initial_dump';
  id: string;
  timestamp: string;
  raw_content: string;
  image_id: string;
}

interface UIDiffAnalysis {
  type: 'ui_diff';
  id: string;
  timestamp: string;
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
  image1_id?: string;
  image2_id?: string;
}

type ActivityItemFromFrontend = InitialFrameDumpAnalysis | UIDiffAnalysis;

interface ExportedDataFromClient {
  workflowSteps: WorkflowStep[];
  frontendLogs: FrontendLogEntry[];
  events: Event[];
  screenshots: ScreenshotForExport[];
  activityItems: ActivityItemFromFrontend[];
}

interface RequestPayload {
  sessionId: string;
  userId: string;
  organizationId?: string;
  exportedData: ExportedDataFromClient;
}

interface UserActivityDataRow {
  session_id: string;
  user_id: string;
  item_type: string;
  client_item_id: string;
  item_data: Record<string, unknown>;
  client_timestamp: string;
}

export async function POST(request: NextRequest) {
  console.log("API route 'ingest-user-activity' invoked.");

  const supabaseAdmin = getSupabaseAdmin();

  try {
    // Extract and validate Authorization header
    const authHeader = request.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('[Ingest-User-Activity] Missing or invalid Authorization header');
      return NextResponse.json(
        { error: 'Unauthorized - Missing authentication token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Validate token
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      console.log('[Ingest-User-Activity] Token validation failed:', validation.error);
      return NextResponse.json(
        { error: `Unauthorized - ${validation.error}` },
        { status: 401 }
      );
    }

    console.log(`[Ingest-User-Activity] Authenticated request from user: ${validation.email}`);

    const body = await request.json();
    const payload = body as RequestPayload;
    const { sessionId, userId, organizationId, exportedData } = payload;

    if (!sessionId || !userId || !exportedData) {
      return NextResponse.json({ error: 'Missing sessionId, userId, or exportedData' }, { status: 400 });
    }

    // Verify userId matches token
    if (userId !== validation.userId) {
      console.log(`[Ingest-User-Activity] userId mismatch - token: ${validation.userId}, payload: ${userId}`);
      return NextResponse.json(
        { error: 'Unauthorized - userId does not match authentication token' },
        { status: 403 }
      );
    }

    // Ensure user exists before logging activity
    const { error: userError } = await supabaseAdmin
      .from('users')
      .upsert({ 
        id: userId, 
        organization_id: organizationId || null 
      }, { onConflict: 'id', ignoreDuplicates: false });

    if (userError) {
      console.error(`Error ensuring user exists:`, userError);
      // We can choose to fail here or continue. For now, let's continue.
    }

    // Also update mediar_users table if organizationId is provided
    if (organizationId) {
      const { error: mediarUserError } = await supabaseAdmin
        .from('mediar_users')
        .upsert({ 
          user_id: userId, 
          organization_id: organizationId 
        }, { onConflict: 'user_id', ignoreDuplicates: false });

      if (mediarUserError) {
        console.error(`Error updating mediar_users organization:`, mediarUserError);
      }
    }
    
    console.log(`Processing data for session ID: ${sessionId} and user ID: ${userId}.`);

    const dataToUpsert: UserActivityDataRow[] = [];

    // Screenshots are no longer processed for storage upload

    // 2. Process Workflow Steps
    if (exportedData.workflowSteps && Array.isArray(exportedData.workflowSteps)) {
      for (const step of exportedData.workflowSteps) {
        if (!step.id || !step.timestamp) continue;
        dataToUpsert.push({
          session_id: sessionId, user_id: userId, item_type: 'workflow_step',
          client_item_id: step.id, item_data: { analysis: step.analysis, parsed: step.parsed },
          client_timestamp: step.timestamp,
        });
      }
    }

    // 3. Process Frontend Logs
    if (exportedData.frontendLogs && Array.isArray(exportedData.frontendLogs)) {
      exportedData.frontendLogs.forEach((log, index) => {
        if (!log || typeof log.message !== 'string' || typeof log.timestamp !== 'number') return;
        const clientLogId = `log-${new Date(log.timestamp).toISOString()}-${index}`;
        dataToUpsert.push({
          session_id: sessionId, user_id: userId, item_type: 'frontend_log',
          client_item_id: clientLogId, item_data: { message: log.message },
          client_timestamp: new Date(log.timestamp).toISOString(),
        });
      });
    }

    // 4. Process Events
    if (exportedData.events && Array.isArray(exportedData.events)) {
      for (const event of exportedData.events) {
        if (!event.id || !event.timestamp) continue;
        dataToUpsert.push({
          session_id: sessionId, user_id: userId, item_type: 'event',
          client_item_id: event.id, item_data: { summary: event.summary, thoughts: event.thoughts },
          client_timestamp: event.timestamp,
        });
      }
    }

    // 5. Process Activity Items
    if (exportedData.activityItems && Array.isArray(exportedData.activityItems)) {
      for (const activity of exportedData.activityItems) {
        if (!activity.id || !activity.type || !activity.timestamp) continue;
        const { type, id, timestamp, ...itemSpecificData } = activity;
        dataToUpsert.push({
          session_id: sessionId, user_id: userId, item_type: type,
          client_item_id: id, item_data: itemSpecificData,
          client_timestamp: timestamp,
        });
      }
    }
    
    // Batch Upsert to the database
    if (dataToUpsert.length > 0) {
      console.log(`Attempting to upsert ${dataToUpsert.length} items to user_activity_data table...`);
      const { error: dbError } = await supabaseAdmin
        .from('user_activity_data')
        .upsert(dataToUpsert, {
          onConflict: 'user_id, session_id, item_type, client_item_id',
        });

      if (dbError) {
        console.error('Database error during upsert:', dbError);
        return NextResponse.json({ error: 'Database upsert failed', details: dbError.message }, { status: 500 });
      }
      console.log(`${dataToUpsert.length} items successfully processed for upsert.`);
    } else {
      console.log("No data prepared to upsert.");
    }

    return NextResponse.json({ message: 'Data processed successfully', itemsProcessed: dataToUpsert.length });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('Critical error in ingest-user-activity route:', error);
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status: 500 });
  }
} 