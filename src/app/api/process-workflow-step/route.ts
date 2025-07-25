import { NextRequest, NextResponse } from 'next/server';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import * as prompts from '@/lib/prompts';
import { WORKFLOW_STEP_ANALYSIS_SCHEMA } from '@/lib/prompts';



// Note: Vertex AI doesn't use the same schema format as Google AI Studio
// We'll handle JSON parsing manually instead
// const mainAnalysisSchema: Schema = {
//     type: SchemaType.OBJECT,
//     properties: {
//         step_title: { type: SchemaType.STRING, description: "Clear, action-oriented title for this step" },
//         step_summary: { type: SchemaType.STRING, description: "Brief summary of what the user accomplished in this step" },
//         events_that_happened: { type: SchemaType.STRING, description: "Specific user actions: clicks, keystrokes, navigation, scrolling, etc." },
//         how_content_changed: { type: SchemaType.STRING, description: "What changed on the screen as a result of the user's actions" },
//         results_if_any: { type: SchemaType.STRING, description: "Outcomes, confirmations, errors, notifications, or responses from the system" },
//         what_was_clicked: { type: SchemaType.STRING, description: "Specific UI elements that were clicked" },
//         what_was_typed: { type: SchemaType.STRING, description: "Text input by the user, if any" },
//         user_intent: { type: SchemaType.STRING, description: "The user's likely goal or intention behind this action" }
//     },
//     required: ['step_title', 'step_summary', 'events_that_happened', 'how_content_changed', 'results_if_any', 'what_was_clicked', 'what_was_typed', 'user_intent']
// };

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

        console.log('🚀 Using Vertex AI for workflow step processing with model:', model);

        // Use structured output for workflow step analysis
        const result = await callVertexWithStructuredOutput(
            actualPrompt,
            context,
            model,
            WORKFLOW_STEP_ANALYSIS_SCHEMA,
            "application/json",
            true // 🔥 ENABLE USAGE METADATA TRACKING
        );

        console.log('✅ Vertex AI step analysis successful');
        
        // 🔥 EXTRACT CONTENT AND USAGE FROM NEW RESPONSE FORMAT
        const analysisContent = result.content;
        const usageMetadata = result.usage;
        
        console.log('📊 Usage metadata:', usageMetadata);
        
        // Return both analysis and structured_output for compatibility with UI route
        return NextResponse.json({
            analysis: analysisContent,
            structured_output: analysisContent,
            usage: usageMetadata ? {
                input_tokens: usageMetadata.promptTokenCount,
                output_tokens: usageMetadata.candidatesTokenCount,
                total_tokens: usageMetadata.totalTokenCount
            } : null
        });

    } catch (error) {
        console.error('Error in POST /api/process-workflow-step:', error);
        return NextResponse.json({ 
            error: 'Analysis failed', 
            details: error instanceof Error ? error.message : 'Unknown error' 
        }, { status: 500 });
    }
} 