import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType, Schema } from "@google/generative-ai";
import * as prompts from '@/lib/prompts'; // Import all prompts from the library
import { LLMStructuredOutput } from '@/types';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const safetySettings: Array<{category: HarmCategory, threshold: HarmBlockThreshold}> = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

const mainAnalysisSchema: Schema = {
    type: SchemaType.OBJECT,
    properties: {
        step_title: { type: SchemaType.STRING, description: "Clear, action-oriented title for this step" },
        step_summary: { type: SchemaType.STRING, description: "Brief summary of what the user accomplished in this step" },
        events_that_happened: { type: SchemaType.STRING, description: "Specific user actions: clicks, keystrokes, navigation, scrolling, etc." },
        how_content_changed: { type: SchemaType.STRING, description: "What changed on the screen as a result of the user's actions" },
        results_if_any: { type: SchemaType.STRING, description: "Outcomes, confirmations, errors, notifications, or responses from the system" },
        what_was_clicked: { type: SchemaType.STRING, description: "Specific UI elements that were clicked" },
        what_was_typed: { type: SchemaType.STRING, description: "Text input by the user, if any" },
        user_intent: { type: SchemaType.STRING, description: "The user's likely goal or intention behind this action" }
    },
    required: ['step_title', 'step_summary', 'events_that_happened', 'how_content_changed', 'results_if_any', 'what_was_clicked', 'what_was_typed', 'user_intent']
};

// Create a map of prompt keys to their actual content
const promptLibrary: { [key: string]: string } = {
  'WORKFLOW_STEP_ANALYSIS_V2_PROMPT': prompts.WORKFLOW_STEP_ANALYSIS_V2_PROMPT,
  // Add other prompts here in the future, e.g.:
  // 'SUMMARIZE_SESSION_PROMPT': prompts.SUMMARIZE_SESSION_PROMPT,
};

export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
    try {
        // The 'prompt' field is now treated as a key
        const { prompt: promptKey, model, context } = await req.json();

        if (!promptKey || !model || !context) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        // Look up the prompt from our server-side library using the key
        const actualPrompt = promptLibrary[promptKey];

        if (!actualPrompt) {
            return NextResponse.json({ error: `Invalid prompt key provided: ${promptKey}` }, { status: 400 });
        }

        const genModel = genAI.getGenerativeModel({ 
            model,
            safetySettings,
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: mainAnalysisSchema,
            }
        });

        const contextString = JSON.stringify(context, null, 2);
        const fullPrompt = `${actualPrompt}\n\nContext:\n${contextString}`;

        const result = await genModel.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();

        let parsedResponse;
        try {
            parsedResponse = JSON.parse(text);
        } catch {
            console.error('Failed to parse LLM response:', text);
            return NextResponse.json({ error: 'Invalid JSON response from LLM' }, { status: 500 });
        }

        // Create structured output with v2 schema
        const structuredOutput: LLMStructuredOutput = {
            ...parsedResponse,
            schema_version: 'v2',
            model_used: model,
            generation_timestamp: new Date().toISOString(),
        };

        return NextResponse.json({ 
            analysis: parsedResponse,
            structured_output: structuredOutput
        });
    } catch (error: unknown) {
        console.error('Error processing workflow step:', error);

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
            message: "Error processing workflow step",
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