import { NextRequest } from 'next/server';
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
  const { analyses, labels, model } = await req.json();

  if (!model) {
    return new Response(JSON.stringify({ error: 'Missing required "model" parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Use a ReadableStream to send events as they happen
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const context = { analyses, labels };

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