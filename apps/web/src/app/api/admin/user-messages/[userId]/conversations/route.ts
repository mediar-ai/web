import { NextRequest, NextResponse } from 'next/server';
import { isMediarAdmin, getEffectiveOrgId } from '@/lib/mediarAuth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/admin/user-messages/[userId]/conversations
 * Load conversation history for user message analysis
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const isAdmin = await isMediarAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const { userId: targetUserId } = await params;

  // Get admin's user ID
  const { userId: adminUserId } = await getEffectiveOrgId();
  if (!adminUserId) {
    return NextResponse.json({ error: 'Could not identify admin user' }, { status: 401 });
  }

  try {
    console.log(`[User Msg Analysis] Loading conversation for target ${targetUserId}, admin ${adminUserId}`);

    const { data: conversation, error } = await supabase
      .from('user_message_analysis_conversations')
      .select('*')
      .eq('target_user_id', targetUserId)
      .eq('admin_user_id', adminUserId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows returned
      console.error('[User Msg Analysis] Error loading:', error);
      throw error;
    }

    if (!conversation) {
      console.log('[User Msg Analysis] No conversation found');
      return NextResponse.json({
        success: true,
        conversation: null,
        message: 'No conversation found',
      });
    }

    console.log(`[User Msg Analysis] Found conversation ${conversation.id} with ${conversation.messages?.length || 0} messages`);

    return NextResponse.json({
      success: true,
      conversation: {
        id: conversation.id,
        target_user_id: conversation.target_user_id,
        messages: conversation.messages || [],
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      },
    });
  } catch (error) {
    console.error('[User Msg Analysis] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load conversation', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/user-messages/[userId]/conversations
 * Save/update conversation
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const isAdmin = await isMediarAdmin();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const { userId: targetUserId } = await params;

  // Get admin's user ID
  const { userId: adminUserId } = await getEffectiveOrgId();
  if (!adminUserId) {
    return NextResponse.json({ error: 'Could not identify admin user' }, { status: 401 });
  }

  try {
    const { messages } = await request.json();

    if (!messages) {
      return NextResponse.json(
        { error: 'messages is required' },
        { status: 400 }
      );
    }

    console.log(`[User Msg Analysis] Saving for target ${targetUserId}, admin ${adminUserId}, ${messages.length} messages`);

    const { data, error } = await supabase
      .from('user_message_analysis_conversations')
      .upsert(
        {
          target_user_id: targetUserId,
          admin_user_id: adminUserId,
          messages: messages,
        },
        {
          onConflict: 'target_user_id,admin_user_id',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('[User Msg Analysis] Save error:', error);
      throw error;
    }

    console.log(`[User Msg Analysis] Saved conversation ${data.id}`);

    return NextResponse.json({
      success: true,
      conversationId: data.id,
    });
  } catch (error) {
    console.error('[User Msg Analysis] Error saving:', error);
    return NextResponse.json(
      { error: 'Failed to save conversation', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
