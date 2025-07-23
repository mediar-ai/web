import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { workflowIds, userId, name } = await req.json();

    if (!workflowIds || !Array.isArray(workflowIds) || workflowIds.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid workflowIds' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Update workflows to saved status
    const { data: updatedWorkflows, error } = await supabaseAdmin
      .from('low_level_workflows')
      .update({
        synthesis_status: 'saved',
        saved_at: new Date().toISOString(),
        saved_by_user_id: userId,
        // Optionally update title if name provided
        ...(name && { title: name })
      })
      .in('id', workflowIds)
      .eq('user_id', userId) // Security: only update user's own workflows
      .select('id, title, created_at, saved_at, synthesis_session_id');

    if (error) {
      console.error('Error saving synthesis:', error);
      return NextResponse.json({ error: 'Failed to save synthesis' }, { status: 500 });
    }

    console.log(`✅ Saved ${updatedWorkflows.length} workflows as synthesis`);

    return NextResponse.json({
      success: true,
      message: `Successfully saved synthesis with ${updatedWorkflows.length} workflows`,
      data: updatedWorkflows
    });

  } catch (error) {
    console.error('Error in save-synthesis:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 