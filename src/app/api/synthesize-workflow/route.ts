import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_SYNTHESIS_PROMPT } from '@/lib/prompts';

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
    const { model: modelName, context } = await req.json();

    if (!modelName || !context || !context.events) {
      return NextResponse.json({ error: 'Missing required parameters: model and context with events' }, { status: 400 });
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
    
    const result = await model.generateContent({
      contents: [{ 
        role: "user", 
        parts: [
          { text: WORKFLOW_SYNTHESIS_PROMPT }, 
          { text: `\n\nWORKFLOW NAME: ${context.workflow_name || 'Unnamed Workflow'}\nTRIGGER: ${context.trigger || 'Not specified'}\nTERMINATOR: ${context.terminator || 'Not specified'}\n\nEVENTS CONTEXT:\n${JSON.stringify(context.events, null, 2)}` }
        ] 
      }],
    });

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