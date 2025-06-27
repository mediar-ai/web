import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  TimelineEventAnalysisResponse,
  WorkflowMappingAnalysisResult,
  UnrelatedEventAnalysisResult
} from '@/lib/timelineMappingTypes';
import { TIMELINE_MAPPING_ANALYSIS_PROMPT } from '@/lib/prompts';
import { FlattenedWorkflowAnalysis } from '@/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// =============================================================================
// LLM Analysis Function
// =============================================================================

async function callLLMForAnalysis(prompt: string, modelName: string = 'gemini-pro'): Promise<{ workflow_mappings?: WorkflowMappingAnalysisResult[]; unrelated_events?: UnrelatedEventAnalysisResult[] }> {
  // For now, this is a placeholder. In a real implementation, you would:
  // 1. Call your LLM service (OpenAI, Anthropic, Gemini, etc.)
  // 2. Parse the JSON response
  // 3. Handle errors appropriately
  
  // Using Gemini as per your env vars
  try {
    const modelToUse = modelName.includes('gemini') ? modelName : 'gemini-pro';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:generateContent?key=` + process.env.GEMINI_API_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status}`);
    }

    const data = await response.json();
    const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!textResponse) {
      throw new Error('No response from LLM');
    }

    // Extract JSON from the response (handle cases where LLM wraps JSON in markdown)
    const jsonMatch = textResponse.match(/```json\n([\s\S]*?)\n```/) || textResponse.match(/```\n([\s\S]*?)\n```/);
    const jsonString = jsonMatch ? jsonMatch[1] : textResponse;
    
    return JSON.parse(jsonString.trim());
    
  } catch (error) {
    console.error('LLM Analysis Error:', error);
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
