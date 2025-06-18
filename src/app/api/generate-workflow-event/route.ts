import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Schema, SchemaType } from '@google/generative-ai';
import { EVENTS_PROMPT } from '@/lib/prompts';

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

const eventSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        event_summary: {
            type: SchemaType.STRING,
            description: "A single, concise sentence summarizing the user's action."
        },
    },
    required: ['event_summary']
};

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: eventSchema,
      },
      safetySettings,
    });
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: EVENTS_PROMPT }, { text: `\n\nLATEST ACTIVITY CONTEXT:\n${JSON.stringify(context.targetAnalysis, null, 2)}` }] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const eventData = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json(eventData);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to generate event summary from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error generating workflow event:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 