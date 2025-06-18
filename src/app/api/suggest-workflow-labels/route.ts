import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';
import { WORKFLOW_LABEL_SUGGESTION_PROMPT } from '@/lib/prompts';

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

const suggestionSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        workflows: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.STRING,
                description: "A potential workflow name."
            }
        },
    },
    required: ['workflows']
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
        responseSchema: suggestionSchema,
      },
      safetySettings,
    });

    const contextParts: Part[] = [];

    if (context.targetAnalysis) {
        contextParts.push({ text: `\n\nTARGET STEP TO LABEL:\n${JSON.stringify(context.targetAnalysis, null, 2)}` });
    }
    if (context.neighborAnalyses && context.neighborAnalyses.length > 0) {
        type NeighborAnalysis = { timestamp: string; analysis: { step: string; description: string } };
        const analysesText = context.neighborAnalyses.map((a: NeighborAnalysis) => `[${new Date(a.timestamp).toISOString()}] ${a.analysis.step}: ${a.analysis.description}`).join('\n');
        contextParts.push({ text: `\n\nNEIGHBORING STEPS (for context):\n${analysesText}` });
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: WORKFLOW_LABEL_SUGGESTION_PROMPT }, ...contextParts] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const suggestion = JSON.parse(response.candidates[0].content.parts[0].text);
        if (suggestion.workflows && Array.isArray(suggestion.workflows)) {
            suggestion.workflows = suggestion.workflows.slice(0, 5);
        }
        return NextResponse.json(suggestion);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to generate suggestions from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error suggesting workflow labels:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
} 