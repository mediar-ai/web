import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, SchemaType, Schema } from "@google/generative-ai";
import { WORKFLOW_STEP_ANALYSIS_V2_PROMPT } from '@/lib/prompts';
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

export async function POST(req: NextRequest) {
    try {
        const { prompt, model, context } = await req.json();

        if (!prompt || !model || !context) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
        }

        // Use the v2 prompt instead of the passed prompt
        const actualPrompt = WORKFLOW_STEP_ANALYSIS_V2_PROMPT;

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
    } catch (error) {
        console.error('Error processing workflow step:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
    }
} 