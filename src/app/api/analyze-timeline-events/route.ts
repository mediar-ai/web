import { NextRequest, NextResponse } from 'next/server';
import { callVertexWithStructuredOutput } from '@/lib/vertexai';
import { TIMELINE_MAPPING_ANALYSIS_PROMPT, TIMELINE_MAPPING_ANALYSIS_SCHEMA } from '@/lib/prompts';

interface WorkflowComponentWithId {
  id: number;
  type_name: string;
  type_description: string;
  conditions: Record<string, unknown>;
}

interface WorkflowInstanceWithId {
  id: number;
  instance_name: string;
  instance_data: Record<string, unknown>;
}

interface WorkflowStepWithId {
  id: number;
  step_name: string;
  substeps: WorkflowSubstepWithId[];
}

interface WorkflowSubstepWithId {
  id: number;
  substep_name: string;
  inputs: string[];
  outputs: string[];
  business_logic: string[];
}

interface ExistingWorkflow {
  id: number;
  title: string;
  description: string;
  workflow_types: Array<{
    type_name: string;
    type_description: string;
    conditions: Record<string, unknown>;
  }>;
  workflow_instances: Array<{
    instance_name: string;
    instance_data: Record<string, unknown>;
  }>;
  steps: Array<{
    step_name: string;
    substeps: Array<{
      substep_name: string;
      inputs: string[];
      outputs: string[];
      business_logic: string[];
    }>;
  }>;
  trigger: string;
  terminator: string;
  // Enhanced with IDs
  workflow_components_with_ids?: {
    workflow_types: WorkflowComponentWithId[];
    workflow_instances: WorkflowInstanceWithId[];
    steps: WorkflowStepWithId[];
  };
}

interface AnalysisEvent {
  analysis_id: string;
  timestamp: string;
  window_title?: string;
  step_title?: string;
  step_summary?: string;
  user_intent?: string;
  events_that_happened?: string;
  how_content_changed?: string;
  results_if_any?: string;
  what_was_clicked?: string;
  what_was_typed?: string;
  labels?: string[];
  workflow?: string;
  step?: string;
  description?: string;
}

// Simplified function to process events - no complex timeline mapping needed!
function processEvents(events: unknown[]): AnalysisEvent[] {
  const analysisEvents = events.map((event: unknown) => {
    if (event && typeof event === 'object') {
      const eventObj = event as Record<string, unknown>;
      
      // Handle new combined structure with analysis object and labels array
      if (eventObj.analysis_data && typeof eventObj.analysis_data === 'object') {
        const analysis = eventObj.analysis_data as Record<string, unknown>;
        return {
          analysis_id: String(eventObj.id), // Use analysis ID directly!
          timestamp: eventObj.client_timestamp as string,
          window_title: eventObj.window_title as string,
          step_title: analysis.step_title as string,
          step_summary: analysis.step_summary as string,
          user_intent: analysis.user_intent as string,
          events_that_happened: analysis.events_that_happened as string,
          how_content_changed: analysis.how_content_changed as string,
          results_if_any: analysis.results_if_any as string,
          what_was_clicked: analysis.what_was_clicked as string,
          what_was_typed: analysis.what_was_typed as string,
          labels: (eventObj.selected_labels as string[]) || []
        } as AnalysisEvent;
      }
      
      // Fallback for legacy structure
      return {
        analysis_id: String(eventObj.id),
        timestamp: (eventObj.client_timestamp || eventObj.timestamp) as string,
        workflow: (eventObj.workflow as string) || 'Unknown',
        step: (eventObj.step as string) || 'Unknown',
        description: (eventObj.description as string) || 'No description'
      } as AnalysisEvent;
    }
    return null;
  }).filter((event): event is AnalysisEvent => event !== null);
  
  return analysisEvents;
}

export async function POST(req: NextRequest) {
  try {
    const { model: modelName, user_id, analyses, userContext, existing_workflows } = await req.json();

    if (!modelName || !user_id || !analyses || !existing_workflows) {
      return NextResponse.json({ 
        error: 'Missing required parameters', 
        details: 'model, user_id, analyses, and existing_workflows are required' 
      }, { status: 400 });
    }

    console.log(`🎯 Analyzing ${analyses.length} analysis events against ${existing_workflows.length} workflows (direct analysis mapping)`);

    // ✅ SIMPLIFIED: Process events directly - no complex timeline mapping!
    const processedEvents = processEvents(analyses);
    
    console.log(`✅ Processed ${processedEvents.length} analysis events (no complex ID lookup needed)`);

    // Format existing workflows for the AI prompt with component IDs
    const workflowDetails = existing_workflows.map((workflow: ExistingWorkflow) => {
      // Use component IDs if available, otherwise fall back to names
      const hasComponentIds = workflow.workflow_components_with_ids;
      
      if (hasComponentIds) {
        const typesInfo = workflow.workflow_components_with_ids!.workflow_types.map(type => 
          `    • ID: ${type.id}, Name: "${type.type_name}", Description: "${type.type_description}"`
        ).join('\n');
        
        const instancesInfo = workflow.workflow_components_with_ids!.workflow_instances.map(instance =>
          `    • ID: ${instance.id}, Name: "${instance.instance_name}"`
        ).join('\n');
        
        const stepsInfo = workflow.workflow_components_with_ids!.steps.map(step => {
          const substepsInfo = step.substeps.map(substep => 
            `      - ID: ${substep.id}, Name: "${substep.substep_name}"`
          ).join('\n');
          return `    • ID: ${step.id}, Name: "${step.step_name}"\n${substepsInfo}`;
        }).join('\n');

        return `WORKFLOW ID: ${workflow.id}
TITLE: ${workflow.title}
DESCRIPTION: ${workflow.description}
TRIGGER: ${workflow.trigger}
TERMINATOR: ${workflow.terminator}

WORKFLOW TYPES (USE THESE IDs):
${typesInfo}

WORKFLOW INSTANCES (USE THESE IDs):
${instancesInfo}

STEPS & SUBSTEPS (USE THESE IDs):
${stepsInfo}`;
      } else {
        // Fallback to text-based format for backwards compatibility
        const typesInfo = workflow.workflow_types.map(type => 
          `    • ${type.type_name}: ${type.type_description}`
        ).join('\n');
        
        const instancesInfo = workflow.workflow_instances.map(instance =>
          `    • ${instance.instance_name}`
        ).join('\n');
        
        const stepsInfo = workflow.steps.map(step => {
          const substepsInfo = step.substeps.map(substep => 
            `      - ${substep.substep_name}`
          ).join('\n');
          return `    • ${step.step_name}\n${substepsInfo}`;
        }).join('\n');

        return `WORKFLOW ID: ${workflow.id}
TITLE: ${workflow.title}
DESCRIPTION: ${workflow.description}
TRIGGER: ${workflow.trigger}
TERMINATOR: ${workflow.terminator}

WORKFLOW TYPES:
${typesInfo}

WORKFLOW INSTANCES:
${instancesInfo}

STEPS & SUBSTEPS:
${stepsInfo}`;
      }
    }).join('\n\n---\n\n');

    // Build the complete prompt
    const prompt = `${TIMELINE_MAPPING_ANALYSIS_PROMPT}

User's High-Level Context:
${JSON.stringify(userContext, null, 2)}

CONFIRMED WORKFLOWS TO MAP TO:
${workflowDetails}

ANALYSIS EVENTS TO MAP:
${JSON.stringify(processedEvents, null, 2)}

IMPORTANT REMINDERS:
- analysis_id MUST be one of the valid IDs from the events above (${processedEvents.map(e => e.analysis_id).join(', ')})
- workflow_template_id MUST match one of the confirmed workflow IDs above (${existing_workflows.map((w: ExistingWorkflow) => w.id).join(', ')})
- Use the component IDs provided in the workflow definitions above
- If no component IDs are available, the mapping will fail - ensure workflows have been properly synthesized with IDs
- If an event doesn't clearly fit any workflow, mark it as unrelated
- If an event fits multiple workflows, create separate mappings for each`;

    // Use structured output for timeline mapping analysis
    const result = await callVertexWithStructuredOutput(
        prompt,
        {}, // Empty context since prompt already includes all needed data
        modelName,
        TIMELINE_MAPPING_ANALYSIS_SCHEMA
    );

    console.log('✅ Vertex AI analysis mapping successful');
    console.log(`📊 Mapped ${result.workflow_mappings?.length || 0} events, ${result.unrelated_events?.length || 0} unrelated`);
    
    return NextResponse.json(result);

  } catch (error) {
    console.error('Error in POST /api/analyze-timeline-events:', error);
    return NextResponse.json({ 
        error: 'Analysis mapping failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
} 