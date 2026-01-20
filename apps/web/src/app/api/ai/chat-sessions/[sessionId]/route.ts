import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getCorsHeaders } from '@/lib/cors';

/**
 * Authenticate request - supports both Clerk auth and desktop token
 */
async function authenticateRequest(request: NextRequest): Promise<{ userId: string | null; error?: string }> {
  // Try Clerk auth first
  const { userId } = await auth();
  if (userId) {
    return { userId };
  }

  // Try desktop token
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const validation = await validateDesktopToken(token);
    if (validation.valid && validation.userId) {
      return { userId: validation.userId };
    }
    return { userId: null, error: validation.error || 'Invalid token' };
  }

  return { userId: null, error: 'Unauthorized' };
}

/**
 * OPTIONS (CORS preflight)
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

/**
 * GET /api/ai/chat-sessions/[sessionId]
 * Load a specific chat session with full messages
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId, error: authError } = await authenticateRequest(request);
    if (!userId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { sessionId } = await params;

    console.log(`[Chat Sessions] Loading session ${sessionId}, user ${userId}`);

    const { data: session, error } = await supabase
      .from('workflow_chat_sessions')
      .select('*')
      .eq('id', parseInt(sessionId))
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Session not found' },
          { status: 404, headers: corsHeaders }
        );
      }
      console.error('[Chat Sessions] Error loading:', error);
      throw error;
    }

    console.log(`[Chat Sessions] Found session ${session.id} with ${session.messages?.length || 0} messages`);

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        workflow_id: session.workflow_id,
        redis_session_id: session.redis_session_id,
        title: session.title,
        message_count: session.message_count,
        messages: session.messages || [],
        created_at: session.created_at,
        updated_at: session.updated_at,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[Chat Sessions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load chat session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
