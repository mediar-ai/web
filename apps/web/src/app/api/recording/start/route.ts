import { Function_ } from 'modal';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    // Validate auth token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - Missing authentication token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);

    if (!validation.valid) {
      return NextResponse.json(
        { error: `Unauthorized - ${validation.error}` },
        { status: 401 }
      );
    }

    const { userId, sessionId, organizationId } = await request.json();

    if (!userId || !sessionId) {
      return NextResponse.json(
        { error: 'userId and sessionId are required' },
        { status: 400 }
      );
    }

    console.log(`[recording/start] Starting recording for user ${userId}, session ${sessionId}`);

    // 1. Create/update session_metadata record
    console.log('[recording/start] Upserting session_metadata...');
    const { error: upsertError } = await supabaseAdmin
      .from('session_metadata')
      .upsert({
        session_id: sessionId,
        user_id: userId,
        event_count: 0,
        processed_event_count: 0,
        stopped: false,
        first_event_timestamp: new Date().toISOString(),
        session_type: 'low-level',
      }, {
        onConflict: 'session_id'
      });

    if (upsertError) {
      console.error('[recording/start] Failed to upsert session_metadata:', upsertError);
      // Continue anyway - session_metadata may be updated by triggers
    }

    // 2. Trigger Modal labeling processor (fire-and-forget)
    let labelingTriggered = false;
    try {
      console.log('[recording/start] Looking up labeling-data-processor...');
      const labelingFn = await Function_.lookup(
        "labeling-data-processor",
        "process_all_labels_for_user"
      );
      // Fire and forget - don't await
      labelingFn.remote([], { user_id: userId }).catch((e: Error) => {
        console.warn('[recording/start] Labeling processor background error:', e.message);
      });
      labelingTriggered = true;
      console.log('[recording/start] Labeling processor triggered');
    } catch (e) {
      console.warn('[recording/start] Failed to trigger labeling processor:', e);
    }

    // 3. Trigger Modal sequential processor (fire-and-forget)
    let processorTriggered = false;
    try {
      console.log('[recording/start] Looking up sequential-workflow-processor...');
      const processorFn = await Function_.lookup(
        "sequential-workflow-processor",
        "process_all_events_for_user"
      );
      // Fire and forget - don't await
      processorFn.remote([], { user_id: userId }).catch((e: Error) => {
        console.warn('[recording/start] Sequential processor background error:', e.message);
      });
      processorTriggered = true;
      console.log('[recording/start] Sequential processor triggered');
    } catch (e) {
      console.warn('[recording/start] Failed to trigger sequential processor:', e);
    }

    console.log(`[recording/start] Recording started. Labeling: ${labelingTriggered}, Processor: ${processorTriggered}`);

    return NextResponse.json({
      success: true,
      sessionId,
      processingTriggered: labelingTriggered || processorTriggered,
      details: {
        labelingTriggered,
        processorTriggered
      }
    });

  } catch (error) {
    console.error('[recording/start] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
