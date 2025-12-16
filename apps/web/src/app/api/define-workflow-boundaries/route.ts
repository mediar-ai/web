import { WORKFLOW_BOUNDARIES_PROMPT, WORKFLOW_BOUNDARIES_SCHEMA } from '@/lib/prompts';
import { buildComprehensiveContext, TranscriptItem } from '@/lib/transcriptUtils';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context, startDate, endDate } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    if (!context.userId) {
      return NextResponse.json({ error: 'Missing userId in context' }, { status: 400 });
    }

    // 🔧 NEW: Require explicit timeframe selection
    if (!startDate || !endDate) {
      return NextResponse.json({ 
        error: 'Timeframe selection is required. Please specify both startDate and endDate for workflow boundary definition.',
        details: 'Select a time period using the timeframe selector before defining workflow boundaries.'
      }, { status: 400 });
    }

    // Handle both single workflow (legacy) and multiple workflows
    const workflowNames = context.workflows.map((w: { workflow_name: string }) => w.workflow_name);
    
    if (!workflowNames || workflowNames.length === 0) {
      return NextResponse.json({ error: 'No workflow names provided' }, { status: 400 });
    }

    // Log time boundary information (now required)
    console.log('Defining workflow boundaries for userId:', context.userId, 'with', workflowNames.length, 'workflows', 'from:', startDate, 'to:', endDate);

    // Fetch analyses from database (reusing logic from fetch-combined-analyses-v2)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch analyses with required time filtering
    const query = supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('id, client_timestamp, window_title, llm_structured_output')
      .eq('user_id', context.userId)
      .gte('client_timestamp', startDate)
      .lte('client_timestamp', endDate);

    const { data: analysesData, error: analysesError } = await query
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
        id: item.id,
        timestamp: item.client_timestamp,
        window_title: item.window_title,
        analysis: cleanAnalysisData,
        labels: selectedLabels
      };
    });

    console.log(`Loaded ${analyses.length} analyses for boundary definition`);

    // Fetch transcripts for the same time range if they exist
    let transcriptsData: TranscriptItem[] = [];
    try {
      let transcriptQuery = supabaseAdmin
        .from('agent_live_transcriptions')
        .select('session_id, role, content, created_at, type, item_id')
        .eq('user_id', context.userId);

      // Apply same time filtering as analyses (now required)
      transcriptQuery = transcriptQuery
        .gte('created_at', startDate)
        .lte('created_at', endDate);

      const { data: transcripts, error: transcriptError } = await transcriptQuery
        .order('created_at', { ascending: true })
        .limit(500); // Limit transcripts to prevent overwhelming context

      if (transcriptError) {
        console.warn('Error fetching transcripts for boundaries:', transcriptError);
      } else {
        transcriptsData = transcripts || [];
        console.log(`Loaded ${transcriptsData.length} transcript items for boundary definition`);
      }
    } catch (error) {
      console.warn('Transcript fetching failed, continuing without transcripts:', error);
    }

    const workflowList = workflowNames.map((name: string) => `- "${name}"`).join('\n');
    
    // Build comprehensive context including transcripts and user instructions
    console.log('🎯 BOUNDARIES: Building context with transcripts and user instructions');
    console.log(`📋 User instructions: ${context.userInstructions ? 'YES - ' + context.userInstructions.substring(0, 50) + '...' : 'NO'}`);
    
    const comprehensiveContext = buildComprehensiveContext(
      transcriptsData, 
      context.userInstructions
    );
    
    const prompt = `${WORKFLOW_BOUNDARIES_PROMPT}

IMPORTANT: You must define boundaries for EXACTLY these workflow names (do not change or create new names):
${workflowList}

User's High-Level Context:
${JSON.stringify(context.userContext, null, 2)}

${comprehensiveContext}

Combined Analyses Data:
The combinedAnalyses array contains events with the following structure:
- id: Unique identifier
- timestamp: When the event occurred  
- window_title: Application/window title
- analysis: Object with step_title, step_summary, user_intent, events_that_happened, etc.
- labels: Array of LLM-generated labels

Combined Analyses:
${JSON.stringify(analyses, null, 2)}`;

    // Use structured output for workflow boundaries
    const result = await callVertexWithStructuredOutput(
        prompt,
        {}, // Empty context since prompt already includes all needed data
        modelName,
        WORKFLOW_BOUNDARIES_SCHEMA,
        "application/json",
        false,
        { trackingSource: 'workflow_analysis' as const }
    );

    console.log('[SUCCESS] Vertex AI workflow boundaries successful');
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in define-workflow-boundaries:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 