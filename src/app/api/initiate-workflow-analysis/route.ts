import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import {
  WORKFLOW_IDENTIFICATION_PROMPT,
  WORKFLOW_IDENTIFICATION_SCHEMA,
  PROMPT_SYNTHESIZE_CONTEXT,
  CONTEXT_SYNTHESIS_SCHEMA,
  PROMPT_REFINE_WORKFLOWS_AND_CONTEXT,
  WORKFLOW_REFINEMENT_SCHEMA,
} from '@/lib/prompts';

function toSSE(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: NextRequest) {
  const { userId, model } = await req.json();

  if (!userId || !model) {
    return new Response(JSON.stringify({ error: 'Missing required "userId" and "model" parameters' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log('Initiating workflow analysis for userId:', userId, 'using model:', model);

  // Use a ReadableStream to send events as they happen
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 0: Fetch analyses from database
        controller.enqueue(toSSE({ status: 'Loading user data...', progress: 10 }));
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
          throw new Error('Missing Supabase environment variables');
        }

        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        
        // Fetch analyses first (reusing logic from fetch-combined-analyses-v2)
        const { data: analysesData, error: analysesError } = await supabaseAdmin
          .from('low_level_workflow_analyses')
          .select('id, client_timestamp, window_title, llm_structured_output')
          .eq('user_id', userId)
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

        console.log(`Loaded ${analyses.length} analyses with ${labelsData?.length || 0} labeled items`);
        controller.enqueue(toSSE({ status: `Loaded ${analyses.length} analyses, starting identification...`, progress: 20 }));

        const context = { combinedAnalyses: analyses };

        // Step 1: Initial Workflow Identification with structured output
        controller.enqueue(toSSE({ status: 'Identifying initial workflows...', progress: 25 }));
        const initialIdentification = await callVertexWithStructuredOutput(
          WORKFLOW_IDENTIFICATION_PROMPT, 
          context, 
          model, 
          WORKFLOW_IDENTIFICATION_SCHEMA
        );
        let workflowNames = initialIdentification.workflow_names || [];
        controller.enqueue(toSSE({ status: 'Initial workflows identified.', progress: 33, data: { workflowNames } }));

        // Step 2: Initial Context Synthesis with structured output
        controller.enqueue(toSSE({ status: 'Synthesizing user context...', progress: 50 }));
        let workflowContext = await callVertexWithStructuredOutput(
          PROMPT_SYNTHESIZE_CONTEXT, 
          context, 
          model, 
          CONTEXT_SYNTHESIS_SCHEMA
        );
        controller.enqueue(toSSE({ status: 'User context synthesized.', progress: 66, data: { workflowContext } }));

        // Step 3: Iterative Refinement Loop with structured output
        controller.enqueue(toSSE({ status: 'Refining workflows with context (2 cycles)...', progress: 75 }));
        for (let i = 0; i < 2; i++) {
          const refinementResult = await callVertexWithStructuredOutput(
            PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, 
            {
              ...context,
            workflow_context: workflowContext,
            workflow_names: workflowNames,
            }, 
            model, 
            WORKFLOW_REFINEMENT_SCHEMA
          );

          // Update context with all fields from refinement
          workflowContext = {
            user_job_role: refinementResult.user_job_role || workflowContext.user_job_role,
            project_name: refinementResult.project_name || workflowContext.project_name,
            user_goal_from_recordings: refinementResult.user_goal_from_recordings || workflowContext.user_goal_from_recordings,
            overall_project_goal: refinementResult.overall_project_goal || workflowContext.overall_project_goal,
            overall_project_description: refinementResult.overall_project_description || workflowContext.overall_project_description,
          };
          workflowNames = refinementResult.refined_workflow_names;
          controller.enqueue(toSSE({ status: `Refinement cycle ${i + 1} complete.`, progress: 75 + ((i+1)*10) }));
        }

        // Step 4: Final Output
        controller.enqueue(toSSE({
          status: 'Analysis complete.',
          progress: 100,
          data: {
            workflowContext,
            workflowNames,
          }
        }));

      } catch (error) {
        console.error('Error in workflow analysis stream:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        controller.enqueue(toSSE({ error: 'Internal server error', details: errorMessage }));
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
} 