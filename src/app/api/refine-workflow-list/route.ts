import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PROMPT_REFINE_WORKFLOWS_AND_CONTEXT } from '@/lib/prompts';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

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
    return JSON.parse(text);
  } catch (error) {
    console.error('Error in callGenerativeModel:', error);
    throw new Error('Failed to parse generative model response');
  }
}

export async function POST(req: NextRequest) {
  const { model, events, workflow_context, draft_workflow_names } = await req.json();

  if (!model || !events || !workflow_context || !draft_workflow_names) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

  try {
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

    // Run one cycle of refinement.
    const refinementResult = await callGenerativeModel(PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, {
      events: processedEvents,
      workflow_context: workflow_context,
      workflow_names: draft_workflow_names,
    }, model);

    const refined_workflow_names = refinementResult.refined_workflow_names;

    return NextResponse.json({ refined_workflow_names });

  } catch (error) {
    console.error('Error in refine-workflow-list:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 