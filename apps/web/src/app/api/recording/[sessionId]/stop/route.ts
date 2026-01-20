import { NextRequest, NextResponse } from 'next/server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(
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
    const { userId } = await request.json();

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    console.log(`[recording/stop] Stopping recording for session ${sessionId}`);

    // Mark session as stopped
    const { error: updateError } = await getSupabaseAdmin()
      .from('session_metadata')
      .update({
        stopped: true,
        stopped_at: new Date().toISOString(),
        last_event_timestamp: new Date().toISOString(),
      })
      .eq('session_id', sessionId);

    if (updateError) {
      console.error('[recording/stop] Failed to update session_metadata:', updateError);
      // Continue anyway - this may fail if session doesn't exist yet
    }

    // Get current pending count
    let pendingCount = 0;
    if (userId) {
      const { data } = await getSupabaseAdmin()
        .rpc('count_unprocessed_events_by_timestamp', { p_user_id: userId });
      pendingCount = data || 0;
    }

    console.log(`[recording/stop] Session ${sessionId} stopped. Pending events: ${pendingCount}`);

    return NextResponse.json({
      success: true,
      sessionId,
      pendingCount,
      message: pendingCount > 0
        ? `Recording stopped. ${pendingCount} events still processing.`
        : 'Recording stopped. All events processed.'
    });

  } catch (error) {
    console.error('[recording/stop] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
