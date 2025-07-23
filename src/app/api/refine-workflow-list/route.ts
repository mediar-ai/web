import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, WORKFLOW_REFINEMENT_SCHEMA } from '@/lib/prompts';

export async function POST(req: NextRequest) {
  try {
    const { userId, workflow_context, draft_workflow_names, model, startDate, endDate } = await req.json();

    if (!model || !userId || !workflow_context || !draft_workflow_names) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

    // Log time boundary information
    if (startDate && endDate) {
      console.log('Refining workflow list for userId:', userId, 'with', draft_workflow_names.length, 'draft workflows', 'from:', startDate, 'to:', endDate);
    } else {
      console.log('Refining workflow list for userId:', userId, 'with', draft_workflow_names.length, 'draft workflows', '(no time boundaries)');
    }

    // Fetch analyses from database (reusing logic from fetch-combined-analyses-v2)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase environment variables');
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Fetch analyses first with optional time filtering
    let query = supabaseAdmin
      .from('low_level_workflow_analyses')
      .select('id, client_timestamp, window_title, llm_structured_output')
      .eq('user_id', userId);

    // Apply time filtering if boundaries are provided
    if (startDate && endDate) {
      query = query
        .gte('client_timestamp', startDate)
        .lte('client_timestamp', endDate);
    }

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

    // Create context with the new combined structure
    const context = {
      combinedAnalyses: analyses,
      workflow_context: workflow_context,
      workflow_names: draft_workflow_names,
    };

    // Use structured output for refinement
    const refinementResult = await callVertexWithStructuredOutput(
      PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, 
      context, 
      model,
      WORKFLOW_REFINEMENT_SCHEMA
    );

    const refined_workflow_names = refinementResult.refined_workflow_names;

    return NextResponse.json({ refined_workflow_names });

  } catch (error) {
    console.error('Error in refine-workflow-list:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 