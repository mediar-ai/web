import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_BOUNDARY_PROMPT } from '@/lib/prompts';

// Removed unused interface - boundaries are handled as Record<string, {trigger: string, terminator: string}>

const getGenAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }
  return new GoogleGenerativeAI(apiKey);
};

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    // ... (safety settings are standard) ...
];

// Define a proper schema with array structure instead of dynamic keys
const boundarySchema: Schema = {
    type: SchemaType.OBJECT,
    description: "Boundaries for multiple workflows",
    properties: {
        workflows: {
            type: SchemaType.ARRAY,
            description: "Array of workflow boundary definitions",
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    workflow_name: {
                        type: SchemaType.STRING,
                        description: "The name of the workflow"
                    },
                    trigger: {
                        type: SchemaType.STRING,
                        description: "The trigger condition that starts this workflow"
                    },
                    terminator: {
                        type: SchemaType.STRING,
                        description: "The condition that ends this workflow"
                    }
                },
                required: ["workflow_name", "trigger", "terminator"]
            }
        }
    },
    required: ["workflows"]
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context || !context.events || !context.workflows) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Handle both single workflow (legacy) and multiple workflows
    const workflowNames = context.workflows.map((w: { workflow_name: string }) => w.workflow_name);
    
    if (!workflowNames || workflowNames.length === 0) {
      return NextResponse.json({ error: 'No workflow names provided' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: boundarySchema,
      },
      safetySettings,
    });
    
    const workflowList = workflowNames.map((name: string) => `- "${name}"`).join('\n');
    
    const prompt = `${WORKFLOW_BOUNDARY_PROMPT}

IMPORTANT: You must define boundaries for EXACTLY these workflow names (do not change or create new names):
${workflowList}

User's High-Level Context:
${JSON.stringify(context.userContext, null, 2)}

Events Context:
${JSON.stringify(context.events, null, 2)}`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const rawResponse = JSON.parse(response.candidates[0].content.parts[0].text);
        
        // Convert array format to object format expected by the frontend
        const boundaries: Record<string, {trigger: string, terminator: string}> = {};
        
        if (rawResponse.workflows && Array.isArray(rawResponse.workflows)) {
            rawResponse.workflows.forEach((workflow: {workflow_name?: string, trigger?: string, terminator?: string}) => {
                if (workflow.workflow_name && workflow.trigger && workflow.terminator) {
                    boundaries[workflow.workflow_name] = {
                        trigger: workflow.trigger,
                        terminator: workflow.terminator
                    };
                }
            });
        }
        
        // Return the boundaries in the expected object format
        return NextResponse.json(boundaries);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to define boundaries from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error defining boundaries:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 