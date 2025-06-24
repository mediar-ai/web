import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  WORKFLOW_IDENTIFICATION_PROMPT,
  PROMPT_SYNTHESIZE_CONTEXT,
  PROMPT_REFINE_WORKFLOWS_AND_CONTEXT,
} from '@/lib/prompts';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Helper function to call the generative model and parse the JSON response
async function callGenerativeModel(prompt: string, context: object, modelName: string) {
  const model = genAI.getGenerativeModel({ model: modelName });
  const fullPrompt = `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`;
  
  try {
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]);
    }
    // Fallback for when the model doesn't use markdown
    return JSON.parse(text);
  } catch (error) {
    console.error('Error in callGenerativeModel:', error);
    throw new Error('Failed to parse generative model response');
  }
}

// Helper function to create a JSON string for SSE
function toSSE(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const { events, model } = await req.json();

  if (!model) {
    return new Response(JSON.stringify({ error: 'Missing required "model" parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Convert V1/V2 mixed events to a consistent format for analysis
  const processedEvents = events.map((event: { analysis?: { raw_llm_output?: { schema_version?: string; step_title?: string; step_summary?: string; user_intent?: string; events_that_happened?: string; how_content_changed?: string; what_was_clicked?: string; what_was_typed?: string; results_if_any?: string; } }; [key: string]: unknown; }) => {
    if (event.analysis) {
      // Check if analysis has V2 structure (llm_structured_output)
      const analysis = event.analysis;
      if (analysis.raw_llm_output && analysis.raw_llm_output.schema_version === 'v2') {
        // Use V2 fields for workflow analysis
        return {
          ...event,
          analysis: {
            workflow: analysis.raw_llm_output.step_title || 'Unknown Workflow',
            step: analysis.raw_llm_output.step_summary || 'Unknown Step',
            description: analysis.raw_llm_output.user_intent || 'No description',
            actions: analysis.raw_llm_output.events_that_happened || 'No actions',
            changes: analysis.raw_llm_output.how_content_changed || 'No changes',
            clicked: analysis.raw_llm_output.what_was_clicked || 'Nothing clicked',
            typed: analysis.raw_llm_output.what_was_typed || 'Nothing typed',
            results: analysis.raw_llm_output.results_if_any || 'No results'
          }
        };
      } else {
        // Keep V1 structure as-is for backward compatibility
        return event;
      }
    }
    return event;
  });

  // Use a ReadableStream to send events as they happen
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Step 1: Initial Workflow Identification
        controller.enqueue(toSSE({ status: 'Identifying initial workflows...', progress: 25 }));
        const initialIdentification = await callGenerativeModel(WORKFLOW_IDENTIFICATION_PROMPT, { events: processedEvents }, model);
        let workflowNames = initialIdentification.workflow_names || [];
        controller.enqueue(toSSE({ status: 'Initial workflows identified.', progress: 33, data: { workflowNames } }));


        // Step 2: Initial Context Synthesis (Bottom-Up)
        controller.enqueue(toSSE({ status: 'Synthesizing user context...', progress: 50 }));
        let workflowContext = await callGenerativeModel(PROMPT_SYNTHESIZE_CONTEXT, { events: processedEvents }, model);
        controller.enqueue(toSSE({ status: 'User context synthesized.', progress: 66, data: { workflowContext } }));

        // Step 3: Iterative Refinement Loop
        controller.enqueue(toSSE({ status: 'Refining workflows with context (2 cycles)...', progress: 75 }));
        for (let i = 0; i < 2; i++) {
          const refinementResult = await callGenerativeModel(PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, {
            events: processedEvents,
            workflow_context: workflowContext,
            workflow_names: workflowNames,
          }, model);

          workflowContext = {
            user_job_role: refinementResult.user_job_role,
            project_name: refinementResult.project_name,
            user_goal_from_recordings: refinementResult.user_goal_from_recordings,
            overall_project_goal: refinementResult.overall_project_goal,
            overall_project_description: refinementResult.overall_project_description,
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
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
} 