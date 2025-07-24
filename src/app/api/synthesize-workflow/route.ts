import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { WORKFLOW_SYNTHESIS_PROMPT } from '@/lib/prompts';
import { WORKFLOW_SYNTHESIS_SCHEMA } from '@/lib/prompts';
import { buildComprehensiveContext, TranscriptItem } from '@/lib/transcriptUtils';

interface WorkflowSynthesisInput {
  name: string;
  trigger?: string;
  terminator?: string;
}

// Helper function to process events (same as original)
function processEvents(events: Array<{ id: string; timestamp: string; window_title: string; analysis: Record<string, unknown>; labels: string[] }>) {
  return events.map(event => ({
    analysis_id: event.id,
    timestamp: event.timestamp,
    window_title: event.window_title,
    ...event.analysis,
    embedded_labels: event.labels // Include labels directly in the event data
  }));
}

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    if (!context.userId) {
      return NextResponse.json({ error: 'Missing userId in context' }, { status: 400 });
    }

    // Fetch analyses from database (reusing logic from fetch-combined-analyses-v2)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch analyses first
    const { data: analysesData, error: analysesError } = await supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('id, client_timestamp, window_title, llm_structured_output')
      .eq('user_id', context.userId)
      .order('client_timestamp', { ascending: false })
      .limit(1000);

    if (analysesError) {
      throw new Error(`Failed to fetch analyses: ${analysesError.message}`);
    }

    if (!analysesData || analysesData.length === 0) {
      throw new Error('No analysis data found for this user');
    }

    // Get all analysis IDs to fetch labels
    const analysisIds = analysesData.map(item => item.id);
    
    // Fetch labels for these analyses
    const { data: labelsData, error: labelsError } = await supabaseAdmin
      .from('low_level_workflow_labeling')
      .select('low_level_workflow_analysis_id, selected_labels')
      .in('low_level_workflow_analysis_id', analysisIds);

    if (labelsError) {
      console.warn('Error fetching labels:', labelsError);
      // Continue without labels rather than failing completely
    }

    // Create a map of analysis_id -> labels for quick lookup
    const labelsMap = new Map();
    labelsData?.forEach(label => {
      labelsMap.set(label.low_level_workflow_analysis_id, label.selected_labels);
    });

    // Transform data to the same format as fetch-combined-analyses-v2
    const analyses = analysesData.map((item: Record<string, unknown>) => {
      // Extract the JSONB analysis data
      const analysisData = item.llm_structured_output || {};
      
      // Remove unwanted fields from analysis data and keep only the ones we want
      const cleanAnalysisData = Object.fromEntries(
        Object.entries(analysisData).filter(([key]) => 
          !['generation_timestamp', 'context_metadata', 'label_status', 'schema_version'].includes(key)
        )
      );

      // Get selected labels from the labels map
      const selectedLabels = labelsMap.get(item.id) || [];

      return {
        id: item.id as string,
        timestamp: item.client_timestamp as string,
        window_title: item.window_title as string,
        analysis: cleanAnalysisData,
        labels: selectedLabels as string[]
      };
    });

    console.log(`Loaded ${analyses.length} analyses for workflow synthesis`);

    // Fetch transcripts for the same time range if they exist
    let transcriptsData: TranscriptItem[] = [];
    try {
      const { data: transcripts, error: transcriptError } = await supabaseAdmin
        .from('agent_live_transcriptions')
        .select('session_id, role, content, created_at, type, item_id')
        .eq('user_id', context.userId)
        .order('created_at', { ascending: true })
        .limit(500); // Limit transcripts to prevent overwhelming context

      if (transcriptError) {
        console.warn('Error fetching transcripts:', transcriptError);
      } else {
        transcriptsData = transcripts || [];
        console.log(`Loaded ${transcriptsData.length} transcript items for synthesis`);
      }
    } catch (error) {
      console.warn('Transcript fetching failed, continuing without transcripts:', error);
    }

    // Check if this is multiple workflows synthesis  
    const isMultipleWorkflows = context.workflows && Array.isArray(context.workflows);
    
    console.log('Synthesizing workflows:', isMultipleWorkflows ? 
      `${context.workflows.length} workflows with ${analyses.length} analyses` :
      `single workflow with ${context.events?.length || 0} events`);
    
    let prompt: string;
    
    if (isMultipleWorkflows && context.workflows) {
      // Multiple workflows synthesis - events are now global
      const processedGlobalEvents = analyses ? processEvents(analyses) : [];
      
      const workflowDetails = context.workflows.map((workflow: WorkflowSynthesisInput) => {
        return `WORKFLOW: ${workflow.name}
TRIGGER: ${workflow.trigger || 'Not specified'}
TERMINATOR: ${workflow.terminator || 'Not specified'}`;
      }).join('\n\n---\n\n');
      
      const workflowNames = context.workflows.map((w: WorkflowSynthesisInput) => w.name).join(', ');
      
      // Build comprehensive context including transcripts and user instructions
      console.log('🚀 SYNTHESIS: Building context with transcripts and user instructions');
      console.log(`📋 User instructions: ${context.userInstructions ? 'YES - ' + context.userInstructions.substring(0, 50) + '...' : 'NO'}`);
      
      const comprehensiveContext = buildComprehensiveContext(
        transcriptsData, 
        context.userInstructions, 
        1000 // Max transcript length for multiple workflows
      );

            console.log('🔗 INJECTING comprehensive context into LLM prompt');
      console.log(`📤 Context length: ${comprehensiveContext.length} characters`);
      
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}
      
      IMPORTANT: You must synthesize workflows for EXACTLY these workflow names (do not change or create new names): ${workflowNames}
      
      User's High-Level Context:
      ${JSON.stringify(context.workflowContext, null, 2)}
      
      ${comprehensiveContext}
      
      WORKFLOW DEFINITIONS:
${workflowDetails}

ALL EVENTS (determine which events belong to which workflows based on the triggers/terminators above):
${JSON.stringify(processedGlobalEvents, null, 2)}

Note: Each event contains embedded labels where available.`;
    } else {
      // Single workflow synthesis (legacy support)
      const processedSingleEvents = context.events ? processEvents(context.events) : [];
      
      // Build comprehensive context including transcripts and user instructions
      console.log('🚀 SYNTHESIS (Single): Building context with transcripts and user instructions');
      console.log(`📋 User instructions: ${context.userInstructions ? 'YES - ' + context.userInstructions.substring(0, 50) + '...' : 'NO'}`);
      
      const comprehensiveContext = buildComprehensiveContext(
        transcriptsData, 
        context.userInstructions, 
        1200 // Max transcript length for single workflow
      );

      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize a workflow with EXACTLY this name (do not change it): ${context.workflow_name}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

${comprehensiveContext}

WORKFLOW: ${context.workflow_name}
TRIGGER: ${context.trigger || 'Not specified'}
TERMINATOR: ${context.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(processedSingleEvents, null, 2)}`;
    }
    
    // Use structured output for workflow synthesis
    const result = await callVertexWithStructuredOutput(
        prompt,
        {}, // Empty context since prompt already includes all needed data
        modelName,
        WORKFLOW_SYNTHESIS_SCHEMA
    );

    console.log('✅ Vertex AI workflow synthesis successful');
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in POST /api/synthesize-workflow:', error);
    return NextResponse.json({ 
        error: 'Workflow synthesis failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 