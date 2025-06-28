import { NextRequest, NextResponse } from 'next/server';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, WORKFLOW_REFINEMENT_SCHEMA } from '@/lib/prompts';
import { FlattenedWorkflowAnalysis } from '@/types';



export async function POST(req: NextRequest) {
  try {
    const { analyses, labels, workflow_context, draft_workflow_names, model } = await req.json();

    if (!model || !analyses || !workflow_context || !draft_workflow_names) {
    return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
  }

    console.log('Refining workflow list with', analyses.length, 'analyses and', draft_workflow_names.length, 'draft workflows');

    // Process analyses to match expected format
    const processedAnalyses = analyses.map((analysis: FlattenedWorkflowAnalysis) => ({
      id: analysis.id,
      timestamp: analysis.client_timestamp,
      workflow: analysis.workflow || 'Unknown',
      step: analysis.step || 'Unknown',
      description: analysis.description || 'No description',
      summary: `${analysis.workflow}: ${analysis.step} - ${analysis.description}`.substring(0, 200)
    }));

    // Use structured output for refinement
    const refinementResult = await callVertexWithStructuredOutput(
      PROMPT_REFINE_WORKFLOWS_AND_CONTEXT, 
      {
        analyses: processedAnalyses,
        labels: labels,
      workflow_context: workflow_context,
      workflow_names: draft_workflow_names,
      }, 
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