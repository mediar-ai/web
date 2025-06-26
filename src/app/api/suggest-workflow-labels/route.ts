import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, Part, Schema, SchemaType } from '@google/generative-ai';
import { CONTEXT_AWARE_STEP_LABEL_PROMPT } from '@/lib/prompts';

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
        label: {
            type: SchemaType.STRING,
            description: "The new, context-aware descriptive string for the target step."
        },
    },
    required: ['label']
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
        type NeighborAnalysis = { timestamp: string; analysis: { step_title?: string; step_summary?: string; step?: string; description?: string } | null };
        const analysesText = context.neighborAnalyses.map((a: NeighborAnalysis) => {
            if (!a.analysis) {
                return `[${new Date(a.timestamp).toISOString()}] [No analysis data available]`;
            }
            const title = a.analysis.step_title || a.analysis.step || 'Untitled';
            const summary = a.analysis.step_summary || a.analysis.description || 'No summary.';
            return `[${new Date(a.timestamp).toISOString()}] ${title}: ${summary}`;
        }).join('\n');
        contextParts.push({ text: `\n\nNEIGHBORING STEPS (for context):\n${analysesText}` });
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: CONTEXT_AWARE_STEP_LABEL_PROMPT }, ...contextParts] }],
    });

    const response = result.response;
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        const suggestion = JSON.parse(response.candidates[0].content.parts[0].text);
        return NextResponse.json(suggestion);
    }
    
    console.error("No valid response from model:", response);
    return NextResponse.json({ error: 'Failed to generate suggestions from the model.' }, { status: 500 });

  } catch (error) {
    console.error('Error suggesting workflow labels:', error);

    let status = 500;
    let statusText = 'Internal Server Error';
    let details: unknown = 'An unknown error occurred';

    if (typeof error === 'object' && error !== null) {
        status = (error as { status?: number }).status || 500;
        statusText = (error as { statusText?: string }).statusText || 'Internal Server Error';
        details = (error as { errorDetails?: unknown }).errorDetails || (error as Error).message || 'An unknown error occurred';
    } else if (error instanceof Error) {
        details = error.message;
    }
    
    // Create a JSON response containing the details of the error
    const errorResponse = {
        message: "Error suggesting workflow labels",
        upstreamError: {
            status: status,
            statusText: statusText,
            details: details,
        }
    };

    // Return a JSON response with the original, specific status code
    return NextResponse.json(errorResponse, { 
        status: status,
        headers: { 'Content-Type': 'application/json' },
    });
  }
} 