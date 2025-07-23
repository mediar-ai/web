import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function extractEventType(payload: Record<string, unknown>): string {
  try {
    // Try payload.payload.type first (most common)
    const nested = payload.payload as Record<string, unknown> | undefined;
    if (nested?.type) {
      return String(nested.type);
    }
    // Fallback to payload.type
    if (payload.type) {
      return String(payload.type);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function extractAppName(payload: Record<string, unknown>): string | null {
  try {
    // Try payload.payload.event.app_name first
    const nested = payload.payload as Record<string, unknown> | undefined;
    const event = nested?.event as Record<string, unknown> | undefined;
    const appName = event?.app_name;
    if (appName && typeof appName === 'string') {
      return appName;
    }
    // Try application as fallback
    const application = event?.application;
    if (application && typeof application === 'string') {
      return application;
    }
    return null;
  } catch {
    return null;
  }
}

function extractHasUiTree(payload: Record<string, unknown>): boolean {
  try {
    const nested = payload.payload as Record<string, unknown> | undefined;
    const event = nested?.event as Record<string, unknown> | undefined;
    const screen = event?.screen as Record<string, unknown> | undefined;
    const uiTree = screen?.ui_tree;
    return !!(uiTree && String(uiTree).trim());
  } catch {
    return false;
  }
}

function extractScreenshotTimestamp(payload: Record<string, unknown>): string | null {
  try {
    const nested = payload.payload as Record<string, unknown> | undefined;
    const event = nested?.event as Record<string, unknown> | undefined;
    const screenshotDiff = event?.screenshot_diff as Record<string, unknown> | undefined;
    const timestamp = screenshotDiff?.after_timestamp;
    return timestamp ? String(timestamp) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { session_id, user_id, payload } = body;

    if (!session_id || !payload || !payload.type) {
      return NextResponse.json({ error: 'session_id and payload with a type are required' }, { status: 400 });
    }

    // Extract timestamp for created_at
    const eventTimestamp = payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString();
    
    // Extract fields for new optimized columns
    const eventType = extractEventType(payload);
    const appName = extractAppName(payload);
    const hasUiTree = extractHasUiTree(payload);
    const screenshotTimestamp = extractScreenshotTimestamp(payload);

    console.log(`[INGEST] Processing ${eventType} event${appName ? ` from ${appName}` : ''} ${hasUiTree ? '(with UI tree)' : ''}`);

    const { error } = await supabaseAdmin
      .from('low_level_events')
      .insert({
        session_id,
        user_id,
        payload: body,
        source: 'windows_app',
        created_at: eventTimestamp, // Use actual event timestamp for proper chronological ordering
        // New optimized columns
        event_type: eventType,
        app_name: appName,
        has_ui_tree: hasUiTree,
        screenshot_timestamp: screenshotTimestamp ? new Date(screenshotTimestamp).toISOString() : null
      });

    if (error) {
      console.error('[INGEST] Error saving raw event:', error);
      return NextResponse.json({ error: 'Failed to save event' }, { status: 500 });
    }

    // The screenshot_diff events will now be processed by the scheduled Modal job,
    // and UI trees will be processed via our existing pipeline

    console.log(`[INGEST] Successfully saved raw event: ${eventType}${appName ? ` (${appName})` : ''}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[INGEST] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
