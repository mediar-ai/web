import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_IDENTIFICATION_PROMPT } from '@/lib/prompts';

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

const identificationSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflow_names: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING }
        },
    },
    required: ['workflow_names']
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context || !context.events) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: identificationSchema,
      },
      safetySettings,
    });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: WORKFLOW_IDENTIFICATION_PROMPT }, { text: `\n\nEVENTS CONTEXT:\n${JSON.stringify(context.events, null, 2)}` }] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const identification = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json(identification);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to identify workflows from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error identifying workflows:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 