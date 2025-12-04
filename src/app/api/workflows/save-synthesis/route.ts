import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { workflowIds, userId, name, sessionState } = await req.json();

    if (!workflowIds || !Array.isArray(workflowIds) || workflowIds.length === 0) {
      return NextResponse.json({ error: 'Missing or invalid workflowIds' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    // Use provided sessionState if available, otherwise fall back to database session data
    const contextData = sessionState?.workflow_context || synthesisSessionData?.session_state?.workflow_context || {};
    const identifiedNames = sessionState?.identified_workflow_names || synthesisSessionData?.session_state?.identified_workflow_names || [];
    const boundaries = sessionState?.workflow_boundaries || synthesisSessionData?.session_state?.workflow_boundaries || {};
    const messages = sessionState?.messages || synthesisSessionData?.session_state?.messages || [];
    const processData = sessionState || synthesisSessionData?.session_state || {};
    
    // Create comprehensive saved synthesis record
    const savedSynthesis = {
      user_id: userId,
      title: name || `Workflow Synthesis - ${new Date().toLocaleDateString()}`,
      synthesis_process_data: processData,
      synthesis_session_id: synthesisSessionId,
      workflow_ids: JSON.stringify(workflowIds),
      workflow_context: contextData,
      identified_workflow_names: JSON.stringify(identifiedNames),
      workflow_boundaries: boundaries,
      conversation_history: messages,
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

    // Update timeline annotations to saved status for this synthesis session
    if (updatedWorkflows.length > 0 && updatedWorkflows[0].synthesis_session_id) {
      const sessionId = updatedWorkflows[0].synthesis_session_id;
      
      const { error: annotationError } = await supabaseAdmin
        .from('raw_timeline_event_annotations')
        .update({ annotation_status: 'saved' })
        .eq('synthesis_session_id', sessionId)
        .eq('user_id', userId)
        .eq('annotation_status', 'draft');

      if (annotationError) {
        console.error('Error updating timeline annotation status:', annotationError);
        // Don't fail the whole operation, just log the error
      } else {
        console.log(`[SUCCESS] Updated timeline annotations to saved status for session: ${sessionId}`);
      }
    }

    console.log(`[SUCCESS] Saved complete synthesis: ${updatedWorkflows.length} workflows with full process data (ID: ${savedSynthesisRecord.id})`);

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