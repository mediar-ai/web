import {
  CONTEXT_SYNTHESIS_SCHEMA,
  PROMPT_REFINE_WORKFLOWS_AND_CONTEXT,
  PROMPT_SYNTHESIZE_CONTEXT,
  TIMELINE_MAPPING_ANALYSIS_PROMPT,
  WORKFLOW_IDENTIFICATION_PROMPT,
  WORKFLOW_IDENTIFICATION_SCHEMA,
  WORKFLOW_REFINEMENT_SCHEMA,
  WORKFLOW_SYNTHESIS_PROMPT,
  WORKFLOW_SYNTHESIS_SCHEMA
} from '@/lib/prompts';
import { buildComprehensiveContext } from '@/lib/transcriptUtils';
import { callVertexWithStructuredOutput, getVertexAIModel } from '@/lib/vertexai';
import { generateEnhancedWorkflowYAML } from '@/lib/workflowExportHelpers';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function addIdsToWorkflowComponents(workflows: any[]): any[] {
  return workflows.map((workflow: any) => {
    const newWorkflow = { ...workflow, id: workflow.id || Date.now() + Math.random() };
    
    newWorkflow.workflow_types = (workflow.workflow_types || []).map((type: any, index: number) => ({
      ...type,
      id: Date.now() + Math.random() + index,
    }));

    newWorkflow.workflow_instances = (workflow.workflow_instances || []).map((instance: any, index: number) => ({
      ...instance,
      id: Date.now() + Math.random() + index,
    }));

    newWorkflow.steps = (workflow.steps || []).map((step: any, index: number) => {
      const newStep = { ...step, id: Date.now() + Math.random() + index };
      newStep.substeps = (step.substeps || []).map((substep: any, subIndex: number) => ({
        ...substep,
        id: Date.now() + Math.random() + index + subIndex,
      }));
      return newStep;
    });

    return newWorkflow;
  });
}

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}



// Helper function to fetch all necessary user data
async function fetchUserData(supabaseAdmin: SupabaseClient, userId: string, startDate?: string, endDate?: string) {
  let analysesQuery = supabaseAdmin
    .from('low_level_workflow_analyses')
    .select('id, client_timestamp, window_title, llm_structured_output')
    .eq('user_id', userId);

  if (startDate && endDate) {
    analysesQuery = analysesQuery.gte('client_timestamp', startDate).lte('client_timestamp', endDate);
  }

  const { data: analysesData, error: analysesError } = await analysesQuery.order('client_timestamp', { ascending: false }).limit(1000);
  if (analysesError) throw new Error(`Failed to fetch analyses: ${analysesError.message}`);
  if (!analysesData || analysesData.length === 0) throw new Error('No analysis data found for this user');

  const analysisIds = analysesData.map(item => item.id);
  const { data: labelsData, error: labelsError } = await supabaseAdmin.from('low_level_workflow_labeling').select('low_level_workflow_analysis_id, selected_labels').in('low_level_workflow_analysis_id', analysisIds);
  if (labelsError) console.warn('Error fetching labels:', labelsError);

  const labelsMap = new Map();
  labelsData?.forEach(label => labelsMap.set(label.low_level_workflow_analysis_id, label.selected_labels));

  const analyses = analysesData.map((item: any) => {
    const analysisData = item.llm_structured_output || {};
    const cleanAnalysisData = Object.fromEntries(Object.entries(analysisData).filter(([key]) => !['generation_timestamp', 'context_metadata', 'label_status', 'schema_version'].includes(key)));
    return { id: item.id, timestamp: item.client_timestamp, window_title: item.window_title, analysis: cleanAnalysisData, labels: labelsMap.get(item.id) || [] };
  });

  let transcriptQuery = supabaseAdmin.from('agent_live_transcriptions').select('session_id, role, content, created_at, type, item_id').eq('user_id', userId);
  if (startDate && endDate) {
    transcriptQuery = transcriptQuery.gte('created_at', startDate).lte('created_at', endDate);
  }
  const { data: transcripts, error: transcriptError } = await transcriptQuery.order('created_at', { ascending: true }).limit(500);
  if (transcriptError) console.warn('Error fetching transcripts:', transcriptError);

  return { analyses, transcriptsData: transcripts || [] };
}

// Helper function to analyze raw timeline events
async function analyzeRawTimelineEvents(model: string, workflow: any, rawEvents: any[], llmLabels: any) {
  const prompt = `
    ${TIMELINE_MAPPING_ANALYSIS_PROMPT}
    
    WORKFLOW COMPONENTS:
    - Workflow Template ID: ${workflow.id}
    - Workflow Types: ${JSON.stringify(workflow.detailed_workflow_data.workflow_components_with_ids.workflow_types, null, 2)}
    - Workflow Instances: ${JSON.stringify(workflow.detailed_workflow_data.workflow_components_with_ids.workflow_instances, null, 2)}
    - Workflow Steps: ${JSON.stringify(workflow.detailed_workflow_data.workflow_components_with_ids.steps, null, 2)}
    
    LLM GENERATED LABELS: ${JSON.stringify(llmLabels, null, 2)}
    
    RAW EVENTS TO ANALYZE:
    ${JSON.stringify(rawEvents.map(e => ({ raw_event_id: e.id, event_type: e.type, payload: e.payload })), null, 2)}
  `;

  // This is a simplified call. The actual implementation in analyze-raw-timeline-events
  // is much more complex, involving batching. For this orchestrator, we'll do a single large call.
  const vertexAI = getVertexAIModel(model);
  const result = await vertexAI.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const response = result.response;
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
      throw new Error('Failed to get a valid response from Vertex AI for timeline mapping.');
  }
  // The text needs to be parsed to get the mappings.
  // Assuming the text is a JSON string.
  return JSON.parse(text);
}


export async function POST(req: NextRequest) {
  try {
    const { userId, model, startDate, endDate, userInstructions } = await req.json();

    if (!userId || !model) {
      return new Response(JSON.stringify({ error: 'Missing required "userId" and "model" parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
        if (!supabaseUrl || !supabaseServiceKey) {
          controller.enqueue(toSSE({ error: 'Missing Supabase environment variables' }));
          controller.close();
          return;
        }
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

        try {
          // Step 1: Fetch Data
          controller.enqueue(toSSE({ status: 'Orchestrator (1/7): Fetching user data...', progress: 5 }));
          const { analyses, transcriptsData } = await fetchUserData(supabaseAdmin, userId, startDate, endDate);
          const dataContext = { combinedAnalyses: analyses, transcripts: transcriptsData, userInstructions };

          // Step 2: Initial Workflow Identification
          controller.enqueue(toSSE({ status: 'Orchestrator (2/7): Identifying initial workflows...', progress: 15 }));
          const initialIdentification = await callVertexWithStructuredOutput(WORKFLOW_IDENTIFICATION_PROMPT, dataContext, model, WORKFLOW_IDENTIFICATION_SCHEMA);
          let workflowNames = initialIdentification.workflow_names || [];
          controller.enqueue(toSSE({ status: 'Orchestrator (2/7): Identifying initial workflows...', progress: 20, data: { draftWorkflowNames: workflowNames } }));

          // Step 3: Initial Context Synthesis
          controller.enqueue(toSSE({ status: 'Orchestrator (3/7): Synthesizing user context...', progress: 30 }));
          let workflowContext = await callVertexWithStructuredOutput(PROMPT_SYNTHESIZE_CONTEXT, dataContext, model, CONTEXT_SYNTHESIS_SCHEMA);
          workflowContext.user_instructions = userInstructions;
          controller.enqueue(toSSE({ status: 'Orchestrator (3/7): Synthesizing user context...', progress: 35, data: { workflowContext } }));

          // Step 4: Iterative Refinement Loop
          controller.enqueue(toSSE({ status: 'Orchestrator (4/7): Refining workflows and context...', progress: 45 }));
          const longTimeout = { timeoutMs: 300000 }; // 5 minutes
          for (let i = 0; i < 2; i++) {
            const refinementResult = await callVertexWithStructuredOutput(PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, { ...dataContext, workflow_context: workflowContext, workflow_names: workflowNames }, model, WORKFLOW_REFINEMENT_SCHEMA, "application/json", false, longTimeout);
            workflowContext = { ...workflowContext, ...refinementResult, user_instructions: userInstructions };
            workflowNames = refinementResult.refined_workflow_names;
          }
          controller.enqueue(toSSE({ status: 'Orchestrator (4/7): Refining workflows and context...', progress: 55, data: { workflowContext, identifiedWorkflowNames: workflowNames } }));

          // Step 5: Full Workflow Synthesis
          controller.enqueue(toSSE({ status: 'Orchestrator (5/7): Synthesizing full workflow...', progress: 60 }));
          const synthesisDataContext = { ...dataContext, workflowContext: workflowContext, workflows: workflowNames.map((name: string) => ({ name })) };
          const synthesisPrompt = `${WORKFLOW_SYNTHESIS_PROMPT}\n\n${buildComprehensiveContext(transcriptsData, userInstructions)}\n\nALL EVENTS:\n${JSON.stringify(analyses, null, 2)}`;
          const synthesisResult = await callVertexWithStructuredOutput(synthesisPrompt, synthesisDataContext, model, WORKFLOW_SYNTHESIS_SCHEMA, "application/json", false, longTimeout);
          const synthesizedWorkflow = synthesisResult.workflows?.[0];
          if (!synthesizedWorkflow) throw new Error("Synthesis did not produce a workflow.");
          
          // ID Generation Step
          const [workflowWithIds] = addIdsToWorkflowComponents([synthesizedWorkflow]);
          const detailed_workflow_data_for_db = {
              ...workflowWithIds,
              workflow_components_with_ids: {
                  workflow_types: workflowWithIds.workflow_types,
                  workflow_instances: workflowWithIds.workflow_instances,
                  steps: workflowWithIds.steps
              }
          };

          controller.enqueue(toSSE({ status: 'Orchestrator (5/7): Synthesizing full workflow...', progress: 70, data: { synthesizedWorkflow: detailed_workflow_data_for_db } }));

          const { data: savedWorkflow, error: saveError } = await supabaseAdmin.from('low_level_workflows').insert({
              user_id: userId,
              title: workflowWithIds.title,
              detailed_workflow_data: detailed_workflow_data_for_db,
              workflow_context: workflowContext,
              synthesis_status: 'saved',
          }).select().single();
          if (saveError) throw new Error(`Failed to save synthesized workflow: ${saveError.message}`);
          
          const workflowForMapping = {
            id: savedWorkflow.id,
            detailed_workflow_data: detailed_workflow_data_for_db
          };

          // Step 6: Create Timeline Mapping
          controller.enqueue(toSSE({ status: 'Orchestrator (6/7): Creating timeline mapping...', progress: 75 }));
          const timelineAnnotations = await analyzeRawTimelineEvents(model, workflowForMapping, analyses, {});
          controller.enqueue(toSSE({ status: 'Orchestrator (6/7): Creating timeline mapping...', progress: 85, data: { timelineAnnotations } }));

          // Step 7: Export Workflow
          controller.enqueue(toSSE({ status: 'Orchestrator (7/7): Exporting workflow...', progress: 90 }));
          const exportData = await generateEnhancedWorkflowYAML(workflowWithIds.title, savedWorkflow, timelineAnnotations.workflow_mappings, workflowContext, null, []);
          
          controller.enqueue(toSSE({ 
            status: 'Complete', 
            progress: 100, 
            data: {
              success: true,
              filename: `${workflowWithIds.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_workflow.yaml`,
              content: exportData,
            }
          }));

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
          controller.enqueue(toSSE({ error: 'Full synthesis orchestration failed', details: errorMessage }));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    // This top-level catch will handle errors from req.json() or other synchronous parts
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to start orchestration', details: errorMessage }, { status: 500 });
  }
} 