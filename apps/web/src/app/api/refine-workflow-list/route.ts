import { PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, WORKFLOW_REFINEMENT_SCHEMA } from '@/lib/prompts';
import { TranscriptItem } from '@/lib/transcriptUtils';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { userId, workflow_context, draft_workflow_names, model, startDate, endDate } = await req.json();

    if (!model || !userId || !workflow_context || !draft_workflow_names) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 🔧 NEW: Require explicit timeframe selection
    if (!startDate || !endDate) {
      return NextResponse.json({ 
        error: 'Timeframe selection is required. Please specify both startDate and endDate for workflow list refinement.',
        details: 'Select a time period using the timeframe selector before refining workflow lists.'
      }, { status: 400 });
    }

    // Log time boundary information (now required)
    console.log('Refining workflow list for userId:', userId, 'with', draft_workflow_names.length, 'draft workflows', 'from:', startDate, 'to:', endDate);

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
      .eq('user_id', userId)
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

    console.log(`Loaded ${analyses.length} analyses for refinement`);

    // Fetch transcripts for the same time range if they exist
    let transcriptsData: TranscriptItem[] = [];
    try {
      let transcriptQuery = supabaseAdmin
        .from('agent_live_transcriptions')
        .select('session_id, role, content, created_at, type, item_id')
        .eq('user_id', userId);

      // Apply same time filtering as analyses (now required)
      transcriptQuery = transcriptQuery
        .gte('created_at', startDate)
        .lte('created_at', endDate);

      const { data: transcripts, error: transcriptError } = await transcriptQuery
        .order('created_at', { ascending: true })
        .limit(500); // Limit transcripts to prevent overwhelming context

      if (transcriptError) {
        console.warn('Error fetching transcripts for refinement:', transcriptError);
      } else {
        transcriptsData = transcripts || [];
        console.log(`Loaded ${transcriptsData.length} transcript items for refinement`);
      }
    } catch (error) {
      console.warn('Transcript fetching failed, continuing without transcripts:', error);
    }

    // Create context with the new combined structure including transcripts
    const context = {
      combinedAnalyses: analyses,
      transcripts: transcriptsData,
      workflow_context: workflow_context,
      workflow_names: draft_workflow_names,
    };

    // Use structured output for refinement
    const refinementResult = await callVertexWithStructuredOutput(
      PROMPT_REFINE_WORKFLOWS_AND_CONTEXT,
      context,
      model,
      WORKFLOW_REFINEMENT_SCHEMA,
      "application/json",
      false,
      { trackingSource: 'workflow_analysis' as const }
    );

    const refined_workflow_names = refinementResult.refined_workflow_names;

    return NextResponse.json({ refined_workflow_names });

  } catch (error) {
    console.error('Error in refine-workflow-list:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 