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
    
    // First, get the workflow details including synthesis_session_id
    const { data: workflows, error: workflowError } = await supabaseAdmin
      .from('low_level_workflows')
      .select('id, title, synthesis_session_id, detailed_workflow_data, created_at')
      .in('id', workflowIds)
      .eq('user_id', userId);

    if (workflowError || !workflows || workflows.length === 0) {
      console.error('Error fetching workflows:', workflowError);
      return NextResponse.json({ error: 'Failed to fetch workflow data' }, { status: 500 });
    }

    // Get the synthesis session data for complete process information
    const synthesisSessionId = workflows[0]?.synthesis_session_id;
    let synthesisSessionData = null;
    
    if (synthesisSessionId) {
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from('synthesis_sessions')
        .select('*')
        .eq('id', synthesisSessionId)
        .single();

      if (!sessionError && sessionData) {
        synthesisSessionData = sessionData;
      }
    }

    // Create comprehensive saved synthesis record
    const savedSynthesis = {
      user_id: userId,
      title: name || `Workflow Synthesis - ${new Date().toLocaleDateString()}`,
      synthesis_process_data: synthesisSessionData?.session_state || {},
      synthesis_session_id: synthesisSessionId,
      workflow_ids: JSON.stringify(workflowIds),
      workflow_context: synthesisSessionData?.session_state?.workflow_context || {},
      identified_workflow_names: JSON.stringify(synthesisSessionData?.session_state?.identified_workflow_names || []),
      workflow_boundaries: synthesisSessionData?.session_state?.workflow_boundaries || {},
      conversation_history: synthesisSessionData?.session_state?.messages || [],
      synthesis_results: workflows.map(w => w.detailed_workflow_data),
      models_used: JSON.stringify(['gemini-2.5-pro']), // Could be extracted from session data
      synthesis_started_at: workflows[0]?.created_at,
      synthesis_completed_at: new Date().toISOString(),
      saved_by_user_id: userId,
      is_active: true
    };

    // Save comprehensive synthesis data
    const { data: savedSynthesisRecord, error: saveError } = await supabaseAdmin
      .from('saved_workflow_syntheses')
      .insert(savedSynthesis)
      .select('*')
      .single();

    if (saveError) {
      console.error('Error saving comprehensive synthesis:', saveError);
      return NextResponse.json({ error: 'Failed to save synthesis data' }, { status: 500 });
    }

    // Update workflows to saved status (for timeline mapping logic)
    const { data: updatedWorkflows, error } = await supabaseAdmin
      .from('low_level_workflows')
      .update({
        synthesis_status: 'saved',
        // Optionally update title if name provided
        ...(name && { title: name })
      })
      .in('id', workflowIds)
      .eq('user_id', userId)
      .select('id, title, created_at, synthesis_session_id');

    if (error) {
      console.error('Error updating workflow status:', error);
      return NextResponse.json({ error: 'Failed to update workflow status' }, { status: 500 });
    }

    console.log(`✅ Saved complete synthesis: ${updatedWorkflows.length} workflows with full process data (ID: ${savedSynthesisRecord.id})`);

    return NextResponse.json({
      success: true,
      message: `Successfully saved synthesis with ${updatedWorkflows.length} workflows and complete process data`,
      data: {
        workflows: updatedWorkflows,
        synthesis: savedSynthesisRecord
      }
    });

  } catch (error) {
    console.error('Error in save-synthesis:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 