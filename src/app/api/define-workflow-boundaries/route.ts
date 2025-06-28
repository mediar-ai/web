import { NextRequest, NextResponse } from 'next/server';
import { WORKFLOW_BOUNDARIES_PROMPT, WORKFLOW_BOUNDARIES_SCHEMA } from '@/lib/prompts';
import { FlattenedWorkflowAnalysis } from '@/types';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';



// Define a proper schema with array structure instead of dynamic keys
// Note: Vertex AI doesn't use the same schema format as Google AI Studio
// We'll handle JSON parsing manually instead
// const boundarySchema: Schema = {
//     type: SchemaType.OBJECT,
//     description: "Boundaries for multiple workflows",
//     properties: {
//         workflows: {
//             type: SchemaType.ARRAY,
//             description: "Array of workflow boundary definitions",
//             items: {
//                 type: SchemaType.OBJECT,
//                 properties: {
//                     workflow_name: {
//                         type: SchemaType.STRING,
//                         description: "The name of the workflow"
//                     },
//                     trigger: {
//                         type: SchemaType.STRING,
//                         description: "The trigger condition that starts this workflow"
//                     },
//                     terminator: {
//                         type: SchemaType.STRING,
//                         description: "The condition that ends this workflow"
//                     }
//                 },
//                 required: ["workflow_name", "trigger", "terminator"]
//             }
//         }
//     },
//     required: ["workflows"]
// };

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Process analyses to match expected format
    const processedAnalyses = context.analyses ? context.analyses.map((analysis: FlattenedWorkflowAnalysis) => ({
      id: analysis.id,
      timestamp: analysis.client_timestamp,
      workflow: analysis.workflow || 'Unknown',
      step: analysis.step || 'Unknown', 
      description: analysis.description || 'No description',
      summary: `${analysis.workflow}: ${analysis.step} - ${analysis.description}`.substring(0, 200)
    })) : [];

    // Handle both single workflow (legacy) and multiple workflows
    const workflowNames = context.workflows.map((w: { workflow_name: string }) => w.workflow_name);
    
    if (!workflowNames || workflowNames.length === 0) {
      return NextResponse.json({ error: 'No workflow names provided' }, { status: 400 });
    }

    console.log('🚀 Using Vertex AI for workflow boundaries with model:', modelName);
    
    const workflowList = workflowNames.map((name: string) => `- "${name}"`).join('\n');
    
    const prompt = `${WORKFLOW_BOUNDARIES_PROMPT}

IMPORTANT: You must define boundaries for EXACTLY these workflow names (do not change or create new names):
${workflowList}

User's High-Level Context:
${JSON.stringify(context.userContext, null, 2)}

Analyses Context:
${JSON.stringify(processedAnalyses, null, 2)}

Labels Context:
${JSON.stringify(context.labels, null, 2)}`;

    // Use structured output for workflow boundaries
    const result = await callVertexWithStructuredOutput(
        prompt,
        {}, // Empty context since prompt already includes all needed data
        modelName,
        WORKFLOW_BOUNDARIES_SCHEMA
    );

    console.log('✅ Vertex AI workflow boundaries successful');
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in POST /api/define-workflow-boundaries:', error);
    return NextResponse.json({ 
        error: 'Boundary definition failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 