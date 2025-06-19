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
    // Run one cycle of refinement.
    const refinementResult = await callGenerativeModel(PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, {
      events,
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