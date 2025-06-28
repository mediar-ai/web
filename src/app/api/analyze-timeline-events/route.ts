import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  TimelineEventAnalysisResponse,
  WorkflowMappingAnalysisResult,
  UnrelatedEventAnalysisResult
} from '@/lib/timelineMappingTypes';
import { TIMELINE_MAPPING_ANALYSIS_PROMPT } from '@/lib/prompts';
import { FlattenedWorkflowAnalysis } from '@/types';
import { getVertexGenAI } from '@/lib/vertexai';
import { HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// =============================================================================
// LLM Analysis Function
// =============================================================================

async function callLLMForAnalysis(prompt: string, modelName: string = 'gemini-2.5-pro'): Promise<{ workflow_mappings?: WorkflowMappingAnalysisResult[]; unrelated_events?: UnrelatedEventAnalysisResult[] }> { // 🔥 Updated to stable Vertex AI model name
  // 🔥 SWITCHED TO VERTEX AI 🔥
  console.log('🚀 Using Vertex AI for timeline analysis with model:', modelName);
  
  try {
    const genAI = getVertexGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      safetySettings,
    });

    const result = await model.generateContent(prompt);

    // 🔥 VERTEX AI RESPONSE HANDLING 🔥
    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const rawText = response.candidates[0].content.parts[0].text;
        console.log('📄 Raw Vertex AI response:', rawText.substring(0, 200) + '...');
        
        // Handle markdown-formatted JSON (remove ```json and ``` markers)
        let cleanedText = rawText.trim();
        if (cleanedText.startsWith('```json')) {
          cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanedText.startsWith('```')) {
          cleanedText = cleanedText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }
        
        try {
          const parsed = JSON.parse(cleanedText);
          console.log('✅ Vertex AI timeline analysis successful');
          return parsed;
        } catch (parseError) {
          console.error('❌ Failed to parse Vertex AI response as JSON:', parseError);
          console.log('🔍 Cleaned text:', cleanedText.substring(0, 300));
          throw new Error(`Invalid JSON response from Vertex AI: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
        }
    }
    
    console.error("No valid response from Vertex AI model:", response);
    throw new Error('Failed to get valid response from Vertex AI model');
  } catch (error) {
    console.error('Vertex AI Timeline Analysis Error:', error);
    throw error;
  }
}

// =============================================================================
// POST: Analyze timeline events and map to workflows
// =============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, analyses, labels, existing_workflows, model = 'gemini-pro' } = body;

    if (!user_id || !analyses || analyses.length === 0) {
      return NextResponse.json({ error: 'user_id and analyses are required' }, { status: 400 });
    }

    if (!existing_workflows || existing_workflows.length === 0) {
      return NextResponse.json({ error: 'existing_workflows are required' }, { status: 400 });
    }

    // Build the analysis prompt using the raw analyses
    const analysesContext = analyses.map((analysis: FlattenedWorkflowAnalysis) => ({
      id: analysis.id,
      timestamp: analysis.client_timestamp,
      workflow: analysis.workflow || 'Unknown',
      step: analysis.step || 'Unknown',
      description: analysis.description || 'No description',
      summary: `${analysis.workflow}: ${analysis.step} - ${analysis.description}`.substring(0, 200)
    }));

    const workflowsContext = existing_workflows.map((workflow: { id: string; title: string; steps: string[]; inputs: string[]; outputs: string[]; business_logic: string[] }) => ({
      id: workflow.id,
      title: workflow.title,
      steps: workflow.steps,
      inputs: workflow.inputs,
      outputs: workflow.outputs,
      business_logic: workflow.business_logic
    }));

    const analysisPrompt = TIMELINE_MAPPING_ANALYSIS_PROMPT
      .replace('{{TIMELINE_EVENTS}}', JSON.stringify(analysesContext, null, 2))
      .replace('{{EXISTING_WORKFLOWS}}', JSON.stringify(workflowsContext, null, 2))
      .replace('{{LABELS_CONTEXT}}', JSON.stringify(labels, null, 2));

    console.log('Starting timeline event analysis for user:', user_id);
    console.log('Analyzing', analyses.length, 'analyses against', existing_workflows.length, 'workflows');
    console.log('With', labels?.length || 0, 'labels');

    // Call LLM for analysis
    const analysisResult = await callLLMForAnalysis(analysisPrompt, model);
    
    // Validate response structure
    if (!analysisResult || typeof analysisResult !== 'object') {
      throw new Error('Invalid LLM response format');
    }

    // Ensure required fields exist
    const workflow_mappings: WorkflowMappingAnalysisResult[] = analysisResult.workflow_mappings || [];
    const unrelated_events: UnrelatedEventAnalysisResult[] = analysisResult.unrelated_events || [];

    // Validate workflow mappings
    const validatedMappings = workflow_mappings.filter(mapping => {
      return mapping.timeline_event_id && 
             mapping.workflow_template_id && 
             mapping.workflow_type_name && 
             mapping.workflow_instance_name && 
             mapping.workflow_step &&
             typeof mapping.confidence_score === 'number';
    });

    // Validate unrelated events
    const validatedUnrelated = unrelated_events.filter(unrelated => {
      return unrelated.timeline_event_id && 
             unrelated.unrelated_reason && 
             typeof unrelated.confidence_score === 'number';
    });

    const response: TimelineEventAnalysisResponse = {
      analysis_timestamp: new Date().toISOString(),
      model_used: model,
      workflow_mappings: validatedMappings,
      unrelated_events: validatedUnrelated,
      total_events_analyzed: analyses.length,
      total_workflow_mappings: validatedMappings.length,
      total_unrelated_events: validatedUnrelated.length
    };

    console.log('Analysis complete:', {
      total_analyses: analyses.length,
      workflow_mappings: validatedMappings.length,
      unrelated_events: validatedUnrelated.length,
      unmapped_events: analyses.length - validatedMappings.length - validatedUnrelated.length
    });

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error in POST /api/analyze-timeline-events:', error);
    return NextResponse.json({ 
      error: 'Analysis failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

// =============================================================================
// GET: Get analysis status or trigger analysis for a session
// =============================================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get('user_id');
    const session_id = searchParams.get('session_id');

    if (!user_id) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    // Fetch recent timeline events for this user/session
    let eventsQuery = supabase
      .from('low_level_events')
      .select('id, timestamp, event_type, payload')
      .eq('user_id', user_id)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (session_id) {
      eventsQuery = eventsQuery.eq('session_id', session_id);
    }

    const { data: events, error: eventsError } = await eventsQuery;

    if (eventsError) {
      return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
    }

    // Fetch existing workflows for this user
    const { data: workflows, error: workflowsError } = await supabase
      .from('low_level_workflows')
      .select('id, title, steps, inputs, outputs, business_logic')
      .eq('user_id', user_id);

    if (workflowsError) {
      return NextResponse.json({ error: 'Failed to fetch workflows' }, { status: 500 });
    }

    // Check how many events already have mappings
    if (events && events.length > 0) {
      const eventIds = events.map(e => e.id);
      
      const { data: mappings } = await supabase
        .from('timeline_event_workflow_mappings')
        .select('timeline_event_id')
        .in('timeline_event_id', eventIds);

      const { data: unrelated } = await supabase
        .from('timeline_event_unrelated')
        .select('timeline_event_id')
        .in('timeline_event_id', eventIds);

      const mappedEventIds = new Set([
        ...(mappings || []).map(m => m.timeline_event_id),
        ...(unrelated || []).map(u => u.timeline_event_id)
      ]);

      const unmappedEvents = events.filter(e => !mappedEventIds.has(e.id));

      return NextResponse.json({
        ready_for_analysis: true,
        total_events: events.length,
        total_workflows: workflows?.length || 0,
        mapped_events: mappedEventIds.size,
        unmapped_events: unmappedEvents.length,
        events: unmappedEvents.slice(0, 10), // Return sample for preview
        workflows: workflows || []
      });
    }

    return NextResponse.json({
      ready_for_analysis: false,
      total_events: 0,
      total_workflows: workflows?.length || 0,
      mapped_events: 0,
      unmapped_events: 0,
      events: [],
      workflows: workflows || []
    });

  } catch (error) {
    console.error('Error in GET /api/analyze-timeline-events:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
