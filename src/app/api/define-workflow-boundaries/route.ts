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

const boundarySchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        trigger: { type: SchemaType.STRING },
        terminator: { type: SchemaType.STRING },
    },
    required: ['trigger', 'terminator']
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context || !context.events || !context.target_workflow_name) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
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
    
    const prompt = `${WORKFLOW_BOUNDARY_PROMPT}\n\nTarget Workflow Name: "${context.target_workflow_name}"\n\nEvents Context:\n${JSON.stringify(context.events, null, 2)}`;

    const result = await model.generateContent(prompt);

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const boundaries = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json(boundaries);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to define boundaries from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error defining boundaries:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 