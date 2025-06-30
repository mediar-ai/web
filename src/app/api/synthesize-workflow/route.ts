import { NextRequest, NextResponse } from 'next/server';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { WORKFLOW_SYNTHESIS_PROMPT } from '@/lib/prompts';
import { WORKFLOW_SYNTHESIS_SCHEMA } from '@/lib/prompts';

interface WorkflowSynthesisInput {
  name: string;
  trigger?: string;
  terminator?: string;
  // No events property - events are now global in context.analyses
}

// Helper function to process events by extracting useful fields
function processEvents(events: unknown[]): unknown[] {
  return events.map((event: unknown) => {
    if (event && typeof event === 'object') {
      const eventObj = event as Record<string, unknown>;
      
      // Handle new combined structure with analysis object and labels array
      if (eventObj.analysis && typeof eventObj.analysis === 'object') {
        const analysis = eventObj.analysis as Record<string, unknown>;
        return {
          id: eventObj.id,
          timestamp: eventObj.timestamp,
          window_title: eventObj.window_title,
          step_title: analysis.step_title,
          step_summary: analysis.step_summary,
          user_intent: analysis.user_intent,
          events_that_happened: analysis.events_that_happened,
          how_content_changed: analysis.how_content_changed,
          results_if_any: analysis.results_if_any,
          what_was_clicked: analysis.what_was_clicked,
          what_was_typed: analysis.what_was_typed,
          labels: eventObj.labels || []
        };
      }
      
      // Fallback for legacy structure
      return {
        id: eventObj.id,
        timestamp: eventObj.client_timestamp || eventObj.timestamp,
        workflow: eventObj.workflow || 'Unknown',
        step: eventObj.step || 'Unknown',
        description: eventObj.description || 'No description'
      };
    }
    return event;
  });
}

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, context } = await req.json();

    if (!modelName || !context) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    // Check if this is multiple workflows synthesis  
    const isMultipleWorkflows = context.workflows && Array.isArray(context.workflows);
    
    console.log('Synthesizing workflows:', isMultipleWorkflows ? 
      `${context.workflows.length} workflows with ${context.analyses?.length || 0} global events` :
      `single workflow with ${context.events?.length || 0} events`);
    
    let prompt: string;
    
    if (isMultipleWorkflows && context.workflows) {
      // Multiple workflows synthesis - events are now global
      const processedGlobalEvents = context.analyses ? processEvents(context.analyses) : [];
      
      const workflowDetails = context.workflows.map((workflow: WorkflowSynthesisInput) => {
        return `WORKFLOW: ${workflow.name}
TRIGGER: ${workflow.trigger || 'Not specified'}
TERMINATOR: ${workflow.terminator || 'Not specified'}`;
      }).join('\n\n---\n\n');
      
      const workflowNames = context.workflows.map((w: WorkflowSynthesisInput) => w.name).join(', ');
      
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize workflows for EXACTLY these workflow names (do not change or create new names): ${workflowNames}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

WORKFLOW DEFINITIONS:
${workflowDetails}

ALL EVENTS (determine which events belong to which workflows based on the triggers/terminators above):
${JSON.stringify(processedGlobalEvents, null, 2)}

Note: Each event contains embedded labels where available.`;
    } else {
      // Single workflow synthesis (legacy support)
      const processedSingleEvents = context.events ? processEvents(context.events) : [];
      prompt = `${WORKFLOW_SYNTHESIS_PROMPT}

IMPORTANT: You must synthesize a workflow with EXACTLY this name (do not change it): ${context.workflow_name}

User's High-Level Context:
${JSON.stringify(context.workflowContext, null, 2)}

WORKFLOW: ${context.workflow_name}
TRIGGER: ${context.trigger || 'Not specified'}
TERMINATOR: ${context.terminator || 'Not specified'}
EVENTS: ${JSON.stringify(processedSingleEvents, null, 2)}`;
    }
    
    // Use structured output for workflow synthesis
    const result = await callVertexWithStructuredOutput(
        prompt,
        {}, // Empty context since prompt already includes all needed data
        modelName,
        WORKFLOW_SYNTHESIS_SCHEMA
    );

    console.log('✅ Vertex AI workflow synthesis successful');
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in POST /api/synthesize-workflow:', error);
    return NextResponse.json({ 
        error: 'Workflow synthesis failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 