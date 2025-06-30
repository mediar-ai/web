import { NextRequest, NextResponse } from 'next/server';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, WORKFLOW_REFINEMENT_SCHEMA } from '@/lib/prompts';



export async function POST(req: NextRequest) {
  try {
    const { analyses, workflow_context, draft_workflow_names, model } = await req.json();

    if (!model || !analyses || !workflow_context || !draft_workflow_names) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

    console.log('Refining workflow list with', analyses.length, 'analyses and', draft_workflow_names.length, 'draft workflows');

    // Create context with the new combined structure
    const context = {
      combinedAnalyses: analyses,
      workflow_context: workflow_context,
      workflow_names: draft_workflow_names,
    };

    // Use structured output for refinement
    const refinementResult = await callVertexWithStructuredOutput(
      PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, 
      context, 
      model,
      WORKFLOW_REFINEMENT_SCHEMA
    );

    const refined_workflow_names = refinementResult.refined_workflow_names;

    return NextResponse.json({ refined_workflow_names });

  } catch (error) {
    console.error('Error in refine-workflow-list:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 