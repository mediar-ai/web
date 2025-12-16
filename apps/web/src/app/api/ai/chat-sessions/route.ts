import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { getCorsHeaders } from '@/lib/cors';
import { resolveWorkflowId } from '@/lib/workflow-id-resolver';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
 * GET /api/ai/chat-sessions?workflowId=123
 * List all chat sessions for a workflow (for current user)
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId, error: authError } = await authenticateRequest(request);
    if (!userId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const searchParams = request.nextUrl.searchParams;
    const workflowId = searchParams.get('workflowId');

    if (!workflowId) {
      return NextResponse.json(
        { error: 'workflowId is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[Chat Sessions] Loading for workflow ${workflowId}, user ${userId}`);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const resolved = await resolveWorkflowId(supabase, workflowId);

    if (resolved.error || !resolved.workflow) {
      return NextResponse.json(
        { error: resolved.error || `Workflow ${workflowId} not found` },
        { status: 404, headers: corsHeaders }
      );
    }

    const workflowIdNum = resolved.workflow.id;

    const { data: sessions, error } = await supabase
      .from('workflow_chat_sessions')
      .select('id, redis_session_id, title, message_count, created_at, updated_at')
      .eq('workflow_id', workflowIdNum)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

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
 * Save/create a chat session
 * Body: { workflowId, redisSessionId, messages, title? }
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId, error: authError } = await authenticateRequest(request);
    if (!userId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const { workflowId, redisSessionId, messages, title } = await request.json();

    if (!workflowId || !redisSessionId) {
      return NextResponse.json(
        { error: 'workflowId and redisSessionId are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[Chat Sessions] Saving session ${redisSessionId} for workflow ${workflowId}, user ${userId}`);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const resolved = await resolveWorkflowId(supabase, String(workflowId));

    if (resolved.error || !resolved.workflow) {
      return NextResponse.json(
        { error: resolved.error || `Workflow ${workflowId} not found` },
        { status: 404, headers: corsHeaders }
      );
    }

    const workflowIdNum = resolved.workflow.id;

    // Note: No ownership check - any logged-in user can save chat sessions to any workflow
    // Chat sessions are scoped by user_id anyway, so each user only sees their own sessions
    console.log(`[Chat Sessions] Saving to workflow ${workflowIdNum} for user ${userId}`);

    // Check if session already exists
    const { data: existing } = await supabase
      .from('workflow_chat_sessions')
      .select('id')
      .eq('redis_session_id', redisSessionId)
      .eq('user_id', userId)
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
          workflow_id: workflowIdNum,
          user_id: userId,
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
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  try {
    const { userId, error: authError } = await authenticateRequest(request);
    if (!userId) {
      return NextResponse.json({ error: authError || 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get('sessionId');

    if (!sessionId) {
      return NextResponse.json(
        { error: 'sessionId is required' },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log(`[Chat Sessions] Deleting session ${sessionId}, user ${userId}`);

    const { error } = await supabase
      .from('workflow_chat_sessions')
      .delete()
      .eq('id', parseInt(sessionId))
      .eq('user_id', userId);

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
