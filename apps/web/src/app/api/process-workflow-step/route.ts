import { NextRequest, NextResponse } from 'next/server';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import * as prompts from '@/lib/prompts';

// Define the schema for structured output
const WORKFLOW_STEP_ANALYSIS_SCHEMA = {
    type: "object",
    properties: {
        events_that_happened: { type: "string" },
        how_content_changed: { type: "string" },
        results_if_any: { type: "string" },
        step_summary: { type: "string" },
        step_title: { type: "string" },
        user_intent: { type: "string" },
        what_was_clicked: { type: "string" },
        what_was_typed: { type: "string" }
    },
    required: [
        "events_that_happened",
        "how_content_changed", 
        "results_if_any",
        "step_summary",
        "step_title",
        "user_intent",
        "what_was_clicked",
        "what_was_typed"
    ]
};

export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
    const requestStart = Date.now();
    let requestId: string | undefined;
    let promptKey: string | undefined;
    let model: string | undefined;
    let contextSize: number | undefined;
    
    try {
        // Generate unique request ID for tracking
        requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🚀 [${requestId}] Starting workflow step processing request`);
        
        // Parse and validate request body with detailed logging
        let requestBody;
        try {
            requestBody = await req.json();
            console.log(`📥 [${requestId}] Request body parsed successfully`);
        } catch (parseError) {
            console.error(`[ERROR] [${requestId}] Failed to parse request body:`, parseError);
            return NextResponse.json({ 
                error: 'Invalid JSON in request body',
                details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
                requestId
            }, { status: 400 });
        }

        // Extract parameters with validation
        const { prompt: promptKey, model, context } = requestBody;
        
        console.log(`[STATS] [${requestId}] Request parameters:`, {
            promptKey,
            model,
            contextType: typeof context,
            contextSize: context ? JSON.stringify(context).length : 0
        });

        if (!promptKey || !model || !context) {
            console.error(`[ERROR] [${requestId}] Missing required parameters:`, {
                hasPromptKey: !!promptKey,
                hasModel: !!model,
                hasContext: !!context
            });
            return NextResponse.json({ 
                error: 'Missing required parameters',
                details: 'promptKey, model, and context are all required',
                requestId
            }, { status: 400 });
        }

        contextSize = JSON.stringify(context).length;
        console.log(`📏 [${requestId}] Context size: ${contextSize} characters`);

                 // Look up the prompt from our server-side library using the key
         const promptLibrary: { [key: string]: string } = {
             'WORKFLOW_STEP_ANALYSIS_V2_PROMPT': prompts.WORKFLOW_STEP_ANALYSIS_V2_PROMPT,
         };
         
         const actualPrompt = promptLibrary[promptKey];

         if (!actualPrompt) {
             console.error(`[ERROR] [${requestId}] Invalid prompt key provided: ${promptKey}`);
             return NextResponse.json({ 
                 error: `Invalid prompt key provided: ${promptKey}`,
                 requestId
             }, { status: 400 });
         }

        console.log(`[SUCCESS] [${requestId}] Prompt resolved successfully. Length: ${actualPrompt.length} characters`);
        console.log(`🚀 [${requestId}] Using Vertex AI for workflow step processing with model: ${model}`);

        // Add system resource monitoring
        const memoryUsage = process.memoryUsage();
        console.log(`[STATS] [${requestId}] System resources:`, {
            heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
            external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
            rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`
        });

        try {
            // Use structured output for workflow step analysis with enhanced error handling
            console.log(`🔄 [${requestId}] Calling Vertex AI with structured output...`);
            const result = await callVertexWithStructuredOutput(
                actualPrompt,
                context,
                model,
                WORKFLOW_STEP_ANALYSIS_SCHEMA,
                "application/json",
                true, // 🔥 ENABLE USAGE METADATA TRACKING
                { trackingSource: 'step_processing' as const }
            );

            console.log(`[SUCCESS] [${requestId}] Vertex AI step analysis successful`);
            
            // 🔥 EXTRACT CONTENT AND USAGE FROM NEW RESPONSE FORMAT
            const analysisContent = result.content;
            const usageMetadata = result.usage;
            
            console.log(`[STATS] [${requestId}] Usage metadata:`, usageMetadata);
            console.log(`[STATS] [${requestId}] Response processing time: ${Date.now() - requestStart}ms`);
            
            // Return both analysis and structured_output for compatibility with UI route
            return NextResponse.json({
                analysis: analysisContent,
                structured_output: analysisContent,
                usage: usageMetadata ? {
                    input_tokens: usageMetadata.promptTokenCount,
                    output_tokens: usageMetadata.candidatesTokenCount,
                    total_tokens: usageMetadata.totalTokenCount
                } : null,
                requestId,
                processingTimeMs: Date.now() - requestStart
            });

        } catch (vertexError) {
            console.error(`[ERROR] [${requestId}] Vertex AI call failed:`, {
                error: vertexError,
                errorType: vertexError instanceof Error ? vertexError.constructor.name : typeof vertexError,
                errorMessage: vertexError instanceof Error ? vertexError.message : String(vertexError),
                stack: vertexError instanceof Error ? vertexError.stack : undefined,
                model,
                promptKey,
                contextSize,
                processingTimeMs: Date.now() - requestStart
            });
            
            // Re-throw to be caught by outer catch block
            throw vertexError;
        }

    } catch (error) {
        const processingTime = Date.now() - requestStart;
        
        // Comprehensive error logging
        console.error(`[ERROR] [${requestId || 'unknown'}] Critical error in POST /api/process-workflow-step:`, {
            error,
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            requestId: requestId || 'unknown',
            promptKey: promptKey || 'unknown',
            model: model || 'unknown',
            contextSize: contextSize || 0,
            processingTimeMs: processingTime,
            timestamp: new Date().toISOString(),
            userAgent: req.headers.get('user-agent'),
            origin: req.headers.get('origin'),
            contentType: req.headers.get('content-type')
        });

        // Determine appropriate error response based on error type
        let statusCode = 500;
        let errorMessage = 'Analysis failed';
        let errorDetails = error instanceof Error ? error.message : 'Unknown error';

        // Handle specific error types
        if (error instanceof Error) {
            if (error.message.includes('timeout')) {
                statusCode = 504;
                errorMessage = 'Request timeout';
                errorDetails = 'The analysis request timed out. This may be due to high system load or complex input.';
            } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
                statusCode = 429;
                errorMessage = 'Rate limit exceeded';
                errorDetails = 'The AI service rate limit has been exceeded. Please try again later.';
            } else if (error.message.includes('Invalid JSON') || error.message.includes('parsing')) {
                statusCode = 422;
                errorMessage = 'Processing error';
                errorDetails = 'Failed to process the AI response. This may be a temporary issue.';
            }
        }

        return NextResponse.json({ 
            error: errorMessage,
            details: errorDetails,
            requestId: requestId || 'unknown',
            processingTimeMs: processingTime,
            timestamp: new Date().toISOString()
        }, { status: statusCode });
    }
} 