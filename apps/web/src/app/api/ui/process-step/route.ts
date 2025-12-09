import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// This is the full URL of the internal processing API
const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
const processStepApiUrl = `${vercelUrl}/api/process-workflow-step`;

// Type for labeling data from database
interface LabelingData {
  low_level_workflow_analysis_id: number;
  selected_labels: string[] | null;
  suggested_labels: string[] | null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, sessionId, clientTimestamp, context, model } = await req.json();

    if (!userId || !sessionId || !clientTimestamp || !context || !model) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // 1. Delete any existing analysis to allow for re-processing
    await supabase
      .from('low_level_workflow_analyses')
      .delete()
      .match({ 
        user_id: userId, 
        client_timestamp: new Date(clientTimestamp).toISOString() 
      });

    // 2. Fetch existing labeling data for context enrichment
    console.log('🏷️ Fetching neighbor analyses and labeling data for enhanced context...');
    
    // Get analyses around this timestamp to provide contextual labeling data
    const targetTime = new Date(clientTimestamp);
    const timeWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
    const beforeTime = new Date(targetTime.getTime() - timeWindow).toISOString();
    const afterTime = new Date(targetTime.getTime() + timeWindow).toISOString();
    
    const { data: neighborAnalyses, error: analysesError } = await supabase
      .from('low_level_workflow_analyses')
      .select('id, client_timestamp, llm_structured_output')
      .eq('user_id', userId)
      .gte('client_timestamp', beforeTime)
      .lte('client_timestamp', afterTime)
      .order('client_timestamp', { ascending: true })
      .limit(10);

    if (analysesError) {
      console.warn('[WARN] Error fetching neighbor analyses:', analysesError);
    }

    // Fetch labeling data for neighbor analyses
    let labelingData: LabelingData[] = [];
    if (neighborAnalyses && neighborAnalyses.length > 0) {
      const analysisIds = neighborAnalyses.map(a => a.id);
      const { data: labelsData, error: labelsError } = await supabase
        .from('low_level_workflow_labeling')
        .select('low_level_workflow_analysis_id, selected_labels, suggested_labels')
        .in('low_level_workflow_analysis_id', analysisIds);

      if (labelsError) {
        console.warn('[WARN] Error fetching labeling data:', labelsError);
      } else {
        labelingData = labelsData || [];
      }
    }

    // Create labeling context map
    const labelingMap = new Map();
    labelingData.forEach(label => {
      labelingMap.set(label.low_level_workflow_analysis_id, {
        selected_labels: label.selected_labels || [],
        suggested_labels: label.suggested_labels || []
      });
    });

    // Enhance context with labeling information
    const enhancedContext = {
      ...context,
      // Add neighbor labeling context for better step understanding
      neighbor_labeling_context: neighborAnalyses?.map(analysis => ({
        timestamp: analysis.client_timestamp,
        step_title: analysis.llm_structured_output?.step_title || 'Unknown',
        step_summary: analysis.llm_structured_output?.step_summary || 'No summary',
        user_intent: analysis.llm_structured_output?.user_intent || 'Unknown intent',
        selected_labels: labelingMap.get(analysis.id)?.selected_labels || [],
        suggested_labels: labelingMap.get(analysis.id)?.suggested_labels || []
      })) || []
    };

    console.log(`🏷️ Enhanced context with ${enhancedContext.neighbor_labeling_context.length} neighbor analyses and labeling data`);

    // 3. Call the original, stateless processing API to generate the analysis with enhanced context
    const processResponse = await fetch(processStepApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: 'WORKFLOW_STEP_ANALYSIS_V2_PROMPT',
        context: enhancedContext, 
        model 
      }),
    });

    if (!processResponse.ok) {
      const errorBody = await processResponse.json();
      throw new Error(`Core processor failed: ${errorBody.details || processResponse.statusText}`);
    }

    const { analysis, structured_output: structuredOutput } = await processResponse.json();

    if (!structuredOutput) {
      throw new Error('Core processor did not return a valid structured_output.');
    }

    // 4. Save the new analysis to the database
    const { error: insertError } = await supabase.from('low_level_workflow_analyses').insert([{
        user_id: userId,
        session_id: sessionId,
        client_timestamp: new Date(clientTimestamp).toISOString(),
        llm_structured_output: structuredOutput,
    }]);

    if (insertError) {
      throw new Error(`Failed to save new analysis to DB: ${insertError.message}`);
    }

    // 5. Return the successful analysis to the UI
    return NextResponse.json({ success: true, analysis });

  } catch (error: unknown) {
    console.error('[API/UI/process-step] Error:', error);

    let status = 500;
    let statusText = 'Internal Server Error';
    let details: unknown = 'An unknown error occurred';

    if (typeof error === 'object' && error !== null) {
        status = (error as { status?: number }).status || 500;
        statusText = (error as { statusText?: string }).statusText || 'Internal Server Error';
        details = (error as { errorDetails?: unknown }).errorDetails || (error as { details?: unknown })?.details || (error as Error).message || 'An unknown error occurred';
    } else if (error instanceof Error) {
        details = error.message;
    }
    
    // Create a JSON response containing the details of the error
    const errorResponse = {
        message: "Failed to process step.",
        upstreamError: {
            status: status,
            statusText: statusText,
            details: details,
        }
    };

    // Return a JSON response with the original, specific status code
    return NextResponse.json(errorResponse, { 
        status: status,
        headers: { 'Content-Type': 'application/json' },
    });
  }
} 