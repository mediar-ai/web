import { CONTEXT_AWARE_STEP_LABEL_PROMPT, WORKFLOW_LABEL_SUGGESTION_SCHEMA } from '@/lib/prompts';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { NextRequest, NextResponse } from 'next/server';




export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    console.log('🚀 Using Vertex AI for workflow label suggestions with model:', modelName);

    let promptText = CONTEXT_AWARE_STEP_LABEL_PROMPT;

    if (context.targetAnalysis) {
        promptText += `\n\nTARGET STEP TO LABEL:\n${JSON.stringify(context.targetAnalysis, null, 2)}`;
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
        promptText += `\n\nNEIGHBORING STEPS (for context):\n${analysesText}`;
    }
    
    // Use structured output for label suggestion
    const result = await callVertexWithStructuredOutput(
        promptText,
        {}, // Empty context since prompt already includes all needed data
        modelName,
        WORKFLOW_LABEL_SUGGESTION_SCHEMA,
        "application/json",
        false,
        { timeoutMs: 240000, trackingSource: 'label_suggestion' as const, trackingUserId: context?.userId } // 4 minutes (240s) to stay under 5min Vercel function limit
    );

    console.log('[SUCCESS] Vertex AI label suggestion successful');
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in POST /api/suggest-workflow-labels:', error);
    return NextResponse.json({ 
        error: 'Label suggestion failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 