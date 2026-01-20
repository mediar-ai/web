import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    // Get the most recent conversation for this user from workflows table
    const { data, error } = await getSupabaseAdmin()
      .from('low_level_workflows')
      .select('id, chat_history')
      .eq('user_id', userId)
      .eq('title', '__CONVERSATION__') // Special title to identify conversation entries
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    // If conversation found, restructure the data to match expected format
    let conversationData = null;
    if (data) {
      conversationData = {
        id: data.id,
        messages: data.chat_history?.messages || [],
        synthesis_step: data.chat_history?.synthesis_step || 'idle',
        identified_workflow_names: data.chat_history?.identified_workflow_names || [],
        timestamp: data.chat_history?.timestamp || new Date().toISOString()
      };
    }

    return NextResponse.json({ 
      success: true, 
      data: conversationData,
      message: conversationData ? 'Conversation found' : 'No conversation found'
    });

  } catch (error) {
    console.error(`Error fetching conversation for user ${userId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    // Delete conversation workflows for this user
    const { error } = await getSupabaseAdmin()
      .from('low_level_workflows')
      .delete()
      .eq('user_id', userId)
      .eq('title', '__CONVERSATION__'); // Only delete conversation entries

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, message: `Deleted conversations for user ${userId}` });

  } catch (error) {
    console.error(`Error deleting conversations for user ${userId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 