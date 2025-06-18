import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(req: NextRequest) {
  try {
    const { events, model } = await req.json();

    if (!model) {
      return NextResponse.json({ error: 'Missing required "model" parameter' }, { status: 400 });
    }

    // Step 1: Initial Workflow Identification
    const initialIdentification = await callGenerativeModel(WORKFLOW_IDENTIFICATION_PROMPT, { events }, model);
    let workflowNames = initialIdentification.workflow_names || [];

    // Step 2: Initial Context Synthesis (Bottom-Up)
    let workflowContext = await callGenerativeModel(PROMPT_SYNTHESIZE_CONTEXT, { events }, model);

    // Step 3: Iterative Refinement Loop (2 cycles)
    for (let i = 0; i < 2; i++) {
      const refinementResult = await callGenerativeModel(PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, {
        events,
        workflow_context: workflowContext,
        workflow_names: workflowNames,
      }, model);

      workflowContext = {
        user_job_role: refinementResult.user_job_role,
        project_name: refinementResult.project_name,
        project_goal: refinementResult.project_goal,
      };
      workflowNames = refinementResult.refined_workflow_names;
    }

    // Step 4: Final Output
    return NextResponse.json({
      success: true,
      workflowContext,
      workflowNames,
    });

  } catch (error) {
    console.error('Error in workflow analysis endpoint:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 