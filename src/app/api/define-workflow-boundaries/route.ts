import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_BOUNDARY_PROMPT } from '@/lib/prompts';

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

// Define a flexible schema for boundary responses
const boundarySchema: Schema = {
    type: SchemaType.OBJECT,
    description: "Boundaries for multiple workflows",
    properties: {
        // We'll let the AI dynamically create workflow name keys
        // The schema will be validated at runtime
    }
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context || !context.events) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Handle both single workflow (legacy) and multiple workflows
    const workflowNames = context.workflow_names || [context.target_workflow_name];
    
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
    const mappingInfo = context.workflow_mapping ? `\n\nWorkflow Name Mapping (Original AI → User Approved):\n${JSON.stringify(context.workflow_mapping, null, 2)}` : '';
    
    const prompt = `${WORKFLOW_BOUNDARY_PROMPT}\n\nWorkflows to Define Boundaries For:\n${workflowList}${mappingInfo}\n\nEvents Context:\n${JSON.stringify(context.events, null, 2)}`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const boundaries = JSON.parse(response.candidates[0].content.parts[0].text);
        
        // Return the boundaries directly  
        return NextResponse.json(boundaries);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to define boundaries from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error defining boundaries:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 