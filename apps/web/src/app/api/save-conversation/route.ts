import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const { userId, messages, synthesisStep, identifiedWorkflowNames, timestamp } = await req.json();

    console.log('Save conversation request:', { 
      userId, 
      messagesCount: messages?.length, 
      synthesisStep, 
      workflowNamesCount: identifiedWorkflowNames?.length 
    });

    if (!userId || !messages || !Array.isArray(messages)) {
      console.error('Missing required parameters:', { userId: !!userId, messages: !!messages, isArray: Array.isArray(messages) });
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Check if there's already a conversation workflow for this user
    const { data: existingConversation, error: selectError } = await getSupabaseAdmin()
      .from('low_level_workflows')
      .select('id, chat_history')
      .eq('user_id', userId)
      .eq('title', '__CONVERSATION__') // Special title to identify conversation entries
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error('Error checking existing conversation:', selectError);
      throw selectError;
    }

    console.log('Existing conversation:', existingConversation);

    const conversationData = {
      user_id: userId,
      title: '__CONVERSATION__',
      chat_history: {
        messages: messages,
        synthesis_step: synthesisStep || 'idle',
        identified_workflow_names: identifiedWorkflowNames || [],
        timestamp: timestamp || new Date().toISOString()
      },
      inputs: [],
      outputs: [],
      steps: [],
      business_logic: []
    };

    let result;
    if (existingConversation) {
      console.log('Updating existing conversation:', existingConversation.id);
      // Update existing conversation
      const { data, error } = await getSupabaseAdmin()
        .from('low_level_workflows')
        .update(conversationData)
        .eq('id', existingConversation.id)
        .select()
        .single();
      
      if (error) {
        console.error('Error updating conversation:', error);
        throw error;
      }
      result = data;
    } else {
      console.log('Creating new conversation');
      // Create new conversation
      const { data, error } = await getSupabaseAdmin()
        .from('low_level_workflows')
        .insert(conversationData)
        .select()
        .single();
      
      if (error) {
        console.error('Error creating conversation:', error);
        throw error;
      }
      result = data;
    }

    console.log('Successfully saved conversation:', result.id);

    return NextResponse.json({ 
      success: true, 
      conversationId: result.id,
      message: existingConversation ? 'Conversation updated' : 'Conversation created'
    });

  } catch (error) {
    console.error('Error saving conversation:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as { code?: string })?.code,
      details: (error as { details?: string })?.details,
      hint: (error as { hint?: string })?.hint
    });
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 