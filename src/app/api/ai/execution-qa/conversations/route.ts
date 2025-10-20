import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/ai/execution-qa/conversations?executionId=123
 * Load conversation history for an execution
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get executionId from query params
    const searchParams = request.nextUrl.searchParams;
    const executionId = searchParams.get('executionId');

    if (!executionId) {
      return NextResponse.json(
        { error: 'executionId is required' },
        { status: 400 }
      );
    }

    console.log(`[QA Conversations] Loading for execution ${executionId}, user ${userId}`);

    // Query conversation
    const { data: conversation, error } = await supabase
      .from('execution_qa_conversations')
      .select('*')
      .eq('execution_id', parseInt(executionId))
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      console.error('[QA Conversations] Error loading:', error);
      throw error;
    }

    if (!conversation) {
      console.log('[QA Conversations] No conversation found');
      return NextResponse.json({
        success: true,
        conversation: null,
        message: 'No conversation found',
      });
    }

    console.log(`[QA Conversations] Found conversation ${conversation.id} with ${conversation.messages?.length || 0} messages`);

    return NextResponse.json({
      success: true,
      conversation: {
        id: conversation.id,
        execution_id: conversation.execution_id,
        messages: conversation.messages || [],
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      },
    });
  } catch (error) {
    console.error('[QA Conversations] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load conversation', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ai/execution-qa/conversations
 * Save/update conversation
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { executionId, messages } = await request.json();

    if (!executionId || !messages) {
      return NextResponse.json(
        { error: 'executionId and messages are required' },
        { status: 400 }
      );
    }

    console.log(`[QA Conversations] Saving for execution ${executionId}, user ${userId}, ${messages.length} messages`);

    const { data, error } = await supabase
      .from('execution_qa_conversations')
      .upsert(
        {
          execution_id: parseInt(executionId),
          user_id: userId,
          messages: messages,
        },
        {
          onConflict: 'execution_id,user_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('[QA Conversations] Save error:', error);
      throw error;
    }

    console.log(`[QA Conversations] Saved conversation ${data.id}`);

    return NextResponse.json({
      success: true,
      conversationId: data.id,
    });
  } catch (error) {
    console.error('[QA Conversations] Error saving:', error);
    return NextResponse.json(
      { error: 'Failed to save conversation', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
