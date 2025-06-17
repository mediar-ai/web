import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';
import { LowLevelEvent } from '@/types';

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

const mainAnalysisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflow: { type: SchemaType.STRING, description: "Best guess of the overall workflow/process name based on what you see." },
        step: { type: SchemaType.STRING, description: "Concise name for this specific step, 3-5 words max." },
        description: { type: SchemaType.STRING, description: "What is happening in 10 or less words." },
        facts: { type: SchemaType.STRING, description: "Key observable facts from the screen." },
        logic: { type: SchemaType.STRING, description: "Business rules or logic you can infer." },
        tech: { type: SchemaType.STRING, description: "Technical details like application, browser, etc." },
        apps: { type: SchemaType.STRING, description: "List of applications or programs visible." },
        context: { type: SchemaType.STRING, description: "Specific context like browser tab titles, URLs, etc." }
    },
    required: ['workflow', 'step', 'description', 'facts', 'logic', 'tech', 'apps', 'context']
};


export async function POST(req: NextRequest) {
  try {
    const { prompt, model: modelName, context } = await req.json();

    if (!prompt || !modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: mainAnalysisSchema,
      },
      safetySettings,
    });

    const contextParts: Part[] = [];

    if (context.screenshotBefore) {
        const parts = context.screenshotBefore.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot Before:" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
    if (context.screenshotAfter) {
        const parts = context.screenshotAfter.split(';base64,');
        if (parts.length === 2) {
            const [mimeType, imageDataBase64] = [parts[0].split(':')[1], parts[1]];
            contextParts.push({ text: "Screenshot After:" });
            contextParts.push({ inlineData: { mimeType, data: imageDataBase64 } });
        }
    }
     if (context.previousUiTree) {
        contextParts.push({ text: `\n\nUI Tree (Before):\n${JSON.stringify(JSON.parse(context.previousUiTree), null, 2)}` });
    }
    if (context.currentUiTree) {
        contextParts.push({ text: `\n\nUI Tree (After):\n${JSON.stringify(JSON.parse(context.currentUiTree), null, 2)}` });
    }
    if (context.events && context.events.length > 0) {
        const eventsText = context.events.map((e: LowLevelEvent) => `[${new Date(e.created_at).toISOString()}] ${e.payload.payload?.type}`).join('\n');
        contextParts.push({ text: `\n\nEvents:\n${eventsText}` });
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }, ...contextParts] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const analysis = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json({ analysis });
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to generate analysis from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error processing workflow step:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 