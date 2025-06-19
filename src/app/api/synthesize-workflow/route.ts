import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_SYNTHESIS_PROMPT } from '@/lib/prompts';

interface WorkflowSynthesisInput {
  name: string;
  trigger?: string;
  terminator?: string;
  events: unknown[]; // Events can have varying structures
}

interface WorkflowContext {
  // Single workflow (legacy)
  workflow_name?: string;
  trigger?: string;
  terminator?: string;
  events?: unknown[];
  
  // Multiple workflows
  workflows?: WorkflowSynthesisInput[];
  workflowContext?: unknown; // Added to accept the new context
}

const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  return new GoogleGenerativeAI(apiKey);
};

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const synthesisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflows: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    title: { type: SchemaType.STRING },
                    inputs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                    outputs: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                    steps: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                    businessLogic: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                },
                required: ['title', 'inputs', 'outputs', 'steps', 'businessLogic']
            }
        },
    },
    required: ['workflows']
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context }: { model: string; context: WorkflowContext } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters: model and context' }, { status: 400 });
    }

    // Handle both single workflow (legacy) and multiple workflows
    const isMultipleWorkflows = context.workflows && Array.isArray(context.workflows);
    
    if (!isMultipleWorkflows && (!context.events || !context.workflow_name)) {
      return NextResponse.json({ error: 'Missing required parameters for single workflow: events and workflow_name' }, { status: 400 });
    }

    if (isMultipleWorkflows && (!context.workflows || !context.workflows.length)) {
      return NextResponse.json({ error: 'No workflows provided for synthesis' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: synthesisSchema,
      },
      safetySettings,
    });
    
    let prompt: string;
    
    if (isMultipleWorkflows && context.workflows) {
      // Multiple workflows synthesis
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const workflowDetails = context.workflows!.map((workflow: WorkflowSynthesisInput) => {
        return `WORKFLOW: ${workflow.name}
TRIGGER: ${workflow.trigger || 'Not specified'}
TERMINATOR: ${workflow.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(workflow.events, null, 2)}`;
      }).join('\n\n---\n\n');
      
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const workflowNames = context.workflows!.map((w: WorkflowSynthesisInput) => w.name).join(', ');
      
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize workflows for EXACTLY these workflow names (do not change or create new names): ${workflowNames}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

${workflowDetails}`;
    } else {
      // Single workflow synthesis (legacy support)
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize a workflow with EXACTLY this name (do not change it): ${context.workflow_name}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

WORKFLOW: ${context.workflow_name}
TRIGGER: ${context.trigger || 'Not specified'}
TERMINATOR: ${context.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(context.events, null, 2)}`;
    }
    
    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const synthesis = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json(synthesis);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to generate workflow synthesis from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error synthesizing workflow:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 