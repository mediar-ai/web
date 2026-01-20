import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getCorsHeaders } from '@/lib/cors';
import { mapClerkUserIdToDbUserId } from '@/lib/orgIdMapping';

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
 * GET /api/ai/chat-sessions
 * List chat sessions for current user (single global session model)
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId: clerkUserId, error: authError } = await authenticateRequest(request);
    if (!clerkUserId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Map Clerk dev user ID to production DB user ID (handles dev/prod mismatch)
    const dbUserId = mapClerkUserIdToDbUserId(clerkUserId);

    console.log(`[Chat Sessions] Loading sessions for user ${dbUserId} (clerk: ${clerkUserId})`);

    const { data: sessions, error } = await supabase
      .from('workflow_chat_sessions')
      .select('id, redis_session_id, title, message_count, created_at, updated_at')
      .eq('user_id', dbUserId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[Chat Sessions] Error loading:', error);
      throw error;
    }

    console.log(`[Chat Sessions] Found ${sessions?.length || 0} sessions`);

    return NextResponse.json({
      success: true,
      sessions: sessions || [],
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[Chat Sessions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load chat sessions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * POST /api/ai/chat-sessions
 * Save/create a chat session (single global session model)
 * Body: { redisSessionId, messages, title? }
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId: clerkUserId, error: authError } = await authenticateRequest(request);
    if (!clerkUserId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Map Clerk dev user ID to production DB user ID (handles dev/prod mismatch)
    const dbUserId = mapClerkUserIdToDbUserId(clerkUserId);

    // Read body as text first for better error handling
    const bodyText = await request.text();
    const contentLength = request.headers.get('content-length');
    console.log(`[Chat Sessions] POST received: ${bodyText.length} chars (Content-Length: ${contentLength})`);

    if (!bodyText || bodyText.trim() === '') {
      console.error('[Chat Sessions] Empty request body received');
      return NextResponse.json(
        { error: 'Empty request body' },
        { status: 400, headers: corsHeaders }
      );
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch (parseError) {
      console.error(`[Chat Sessions] JSON parse error. Body preview: ${bodyText.substring(0, 200)}...`);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { redisSessionId, messages, title } = body;

    if (!redisSessionId) {
      return NextResponse.json(
        { error: 'redisSessionId is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[Chat Sessions] Saving session ${redisSessionId} for user ${dbUserId}`);

    // Check if session already exists
    const { data: existing } = await supabase
      .from('workflow_chat_sessions')
      .select('id')
      .eq('redis_session_id', redisSessionId)
      .eq('user_id', dbUserId)
      .single();

    let result;
    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from('workflow_chat_sessions')
        .update({
          messages: messages || [],
          message_count: messages?.length || 0,
          title: title || null,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      result = data;
      console.log(`[Chat Sessions] Updated session ${result.id}`);
    } else {
      // Create new
      const { data, error } = await supabase
        .from('workflow_chat_sessions')
        .insert({
          user_id: dbUserId,
          redis_session_id: redisSessionId,
          messages: messages || [],
          message_count: messages?.length || 0,
          title: title || null,
        })
        .select()
        .single();

      if (error) throw error;
      result = data;
      console.log(`[Chat Sessions] Created session ${result.id}`);
    }

    return NextResponse.json({
      success: true,
      session: {
        id: result.id,
        redis_session_id: result.redis_session_id,
        message_count: result.message_count,
        created_at: result.created_at,
        updated_at: result.updated_at,
      },
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[Chat Sessions] Error saving:', error);
    return NextResponse.json(
      { error: 'Failed to save chat session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * DELETE /api/ai/chat-sessions?sessionId=123
 * Delete a chat session
 */
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId: clerkUserId, error: authError } = await authenticateRequest(request);
    if (!clerkUserId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    // Map Clerk dev user ID to production DB user ID (handles dev/prod mismatch)
    const dbUserId = mapClerkUserIdToDbUserId(clerkUserId);

    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[Chat Sessions] Deleting session ${sessionId}, user ${dbUserId}`);

    const { error } = await supabase
      .from('workflow_chat_sessions')
      .delete()
      .eq('id', parseInt(sessionId))
      .eq('user_id', dbUserId);

    if (error) {
      console.error('[Chat Sessions] Delete error:', error);
      throw error;
    }

    console.log(`[Chat Sessions] Deleted session ${sessionId}`);

    return NextResponse.json({
      success: true,
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('[Chat Sessions] Error deleting:', error);
    return NextResponse.json(
      { error: 'Failed to delete chat session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
