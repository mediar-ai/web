import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
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

    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    console.log(`[recording/progress] Fetching progress for session ${sessionId}`);

    // Get session metadata
    const { data: session, error: sessionError } = await supabaseAdmin
      .from('session_metadata')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (sessionError || !session) {
      // Session may not exist yet if no events have been processed
      // Return empty progress instead of error
      return NextResponse.json({
        sessionId,
        status: 'recording',
        eventCount: 0,
        uiTreeEventCount: 0,
        processedCount: 0,
        pendingCount: 0,
        progressPercent: 0,
        estimatedSecondsRemaining: null,
        firstEventAt: null,
        lastEventAt: null,
        recordingDurationSeconds: 0,
      });
    }

    // Get accurate counts using RPC functions (same logic as workflow-status)
    // Skip if user_id is null (legacy sessions before Clerk ID migration)
    let pendingCount = 0;
    let processedCount = 0;

    if (session.user_id) {
      const { data: pending, error: pendingError } = await supabaseAdmin
        .rpc('count_unprocessed_events_by_timestamp', { p_user_id: session.user_id });

      if (pendingError) {
        console.warn('[recording/progress] Error fetching pending count:', pendingError);
      } else {
        pendingCount = pending || 0;
      }

      const { data: processed, error: processedError } = await supabaseAdmin
        .rpc('count_processed_events_by_timestamp', { p_user_id: session.user_id });

      if (processedError) {
        console.warn('[recording/progress] Error fetching processed count:', processedError);
      } else {
        processedCount = processed || 0;
      }
    } else {
      console.log('[recording/progress] Skipping RPC calls - session has no user_id (legacy session)');
    }

    const totalUiTrees = (pendingCount || 0) + (processedCount || 0);
    const progressPercent = totalUiTrees > 0
      ? Math.round((processedCount || 0) / totalUiTrees * 100)
      : 0;

    // Estimate remaining time based on processing rate
    let estimatedSecondsRemaining: number | null = null;
    if (session.first_event_timestamp && (processedCount || 0) > 0 && (pendingCount || 0) > 0) {
      const elapsedMs = Date.now() - new Date(session.first_event_timestamp).getTime();
      const eventsPerMs = (processedCount || 0) / elapsedMs;
      if (eventsPerMs > 0) {
        estimatedSecondsRemaining = Math.round((pendingCount || 0) / eventsPerMs / 1000);
      }
    }

    // Calculate recording duration
    let recordingDurationSeconds = 0;
    if (session.first_event_timestamp) {
      const endTime = session.stopped_at ? new Date(session.stopped_at) : new Date();
      recordingDurationSeconds = Math.round(
        (endTime.getTime() - new Date(session.first_event_timestamp).getTime()) / 1000
      );
    }

    // Determine status
    let status: 'recording' | 'processing' | 'ready_for_synthesis' | 'synthesizing' | 'complete' = 'recording';
    if (session.synthesis_complete) {
      status = 'complete';
    } else if (session.synthesizing) {
      status = 'synthesizing';
    } else if (session.stopped && (pendingCount || 0) === 0) {
      status = 'ready_for_synthesis';
    } else if (session.stopped) {
      status = 'processing';
    }

    const response = {
      sessionId,
      status,
      eventCount: session.event_count || 0,
      uiTreeEventCount: totalUiTrees,
      processedCount: processedCount || 0,
      pendingCount: pendingCount || 0,
      progressPercent,
      estimatedSecondsRemaining,
      firstEventAt: session.first_event_timestamp,
      lastEventAt: session.last_event_timestamp,
      recordingDurationSeconds,
    };

    console.log(`[recording/progress] Session ${sessionId}: ${status}, ${processedCount}/${totalUiTrees} processed`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('[recording/progress] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
