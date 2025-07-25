import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as yaml from 'js-yaml';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

interface WorkflowExportRequest {
  userId: string;
  workflowId: number;
  selectedWorkflowName?: string;
}

interface WorkflowStep {
  tool_name: string;
  arguments: Record<string, unknown>;
}

interface WorkflowStepGroup {
  group_name: string;
  skippable: boolean;
  steps: WorkflowStep[];
}

interface VariableDefinition {
  type: string;
  label: string;
  description: string;
  default: string;
  regex?: string;
  validation_message?: string;
}

interface WorkflowYAMLData {
  tool_name: string;
  arguments: {
    variables: Record<string, VariableDefinition>;
    inputs: Record<string, string>;
    selectors: Record<string, string>;
    steps: WorkflowStepGroup[];
  };
}

interface TimelineAnnotation {
  analysis_id: number;
  is_workflow_related: boolean;
  workflow_id: number | null;
  step_name?: string | null;
  substep_name?: string | null;
  inputs?: string[] | null;
  outputs?: string[] | null;
  business_logic?: string[] | null;
  confidence_score?: number | null;
  step_title?: string;
  user_intent?: string;
  step_summary?: string;
  events_that_happened?: string;
  how_content_changed?: string;
  results_if_any?: string;
  what_was_clicked?: string;
  what_was_typed?: string;
  created_at: string;
}

interface WorkflowContext {
  user_job_role: string;
  project_name: string;
  user_goal_from_recordings: string;
  overall_project_goal: string;
  overall_project_description: string;
  user_instructions?: string;
}

interface SavedSynthesis {
  id: number;
  title: string;
  workflow_context: WorkflowContext;
  synthesis_process_data: Record<string, unknown>;
  created_at: string;
}

interface WorkflowData {
  id: number;
  title: string;
  detailed_workflow_data: Record<string, unknown>;
  synthesis_session_id: number | null;
  created_at: string;
  inputs: string[] | null;
  outputs: string[] | null;
  steps: string[] | null;
  business_logic: string[] | null;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, workflowId, selectedWorkflowName }: WorkflowExportRequest = await req.json();

    if (!userId || !workflowId) {
      return NextResponse.json({ error: 'Missing userId or workflowId' }, { status: 400 });
    }

    console.log(`🔄 Starting workflow export for user ${userId}, workflow ${workflowId}`);

    // 1. Get specific workflow details
    console.log(`📋 Fetching workflow details for ID ${workflowId}...`);
    const { data: targetWorkflow, error: workflowError } = await supabaseAdmin
      .from('low_level_workflows')
      .select(`
        id, 
        title, 
        detailed_workflow_data, 
        synthesis_session_id,
        created_at,
        inputs,
        outputs,
        steps,
        business_logic
      `)
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single() as { data: WorkflowData | null; error: unknown };

    if (workflowError || !targetWorkflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // 3. Get saved synthesis data for context
    console.log('📋 Fetching synthesis context...');
    let synthesisContext: WorkflowContext | null = null;
    let savedSynthesis: SavedSynthesis | null = null;

    if (targetWorkflow.synthesis_session_id) {
      const { data: synthesis, error: synthesisError } = await supabaseAdmin
        .from('saved_workflow_syntheses')
        .select('id, title, workflow_context, synthesis_process_data, created_at')
        .eq('synthesis_session_id', targetWorkflow.synthesis_session_id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!synthesisError && synthesis) {
        savedSynthesis = synthesis;
        synthesisContext = synthesis.workflow_context;
      }
    }

    // 4. Get timeline mapping data for this workflow
    console.log('📋 Fetching timeline annotations...');
    const { data: timelineAnnotations, error: timelineError } = await supabaseAdmin
      .from('raw_timeline_event_annotations')
      .select(`
        analysis_id,
        is_workflow_related,
        workflow_template_id,
        inputs,
        outputs,
        business_logics,
        confidence_score,
        created_at,
        analysis_data:low_level_workflow_analyses!raw_timeline_event_annotations_analysis_id_fkey(
          id,
          llm_structured_output,
          window_title
        )
      `)
      .eq('user_id', userId)
      .eq('workflow_template_id', workflowId)
      .eq('is_workflow_related', true)
      .order('created_at', { ascending: true })
      .limit(100);

    if (timelineError) {
      console.warn('Error fetching timeline annotations:', timelineError);
    }

    const annotations: TimelineAnnotation[] = (timelineAnnotations || []).map((annotation: Record<string, unknown>) => {
      const analysisData = annotation.analysis_data as Record<string, unknown> | null;
      const structuredOutput = (analysisData?.llm_structured_output as Record<string, unknown>) || {};
      
      return {
        analysis_id: annotation.analysis_id as number,
        is_workflow_related: annotation.is_workflow_related as boolean,
        workflow_id: annotation.workflow_template_id as number | null,
        inputs: typeof annotation.inputs === 'string' ? [annotation.inputs] : (annotation.inputs as string[] | null),
        outputs: typeof annotation.outputs === 'string' ? [annotation.outputs] : (annotation.outputs as string[] | null),
        business_logic: typeof annotation.business_logics === 'string' ? [annotation.business_logics] : (annotation.business_logics as string[] | null),
        confidence_score: annotation.confidence_score as number | null,
        step_title: structuredOutput.step_title as string | undefined,
        user_intent: structuredOutput.user_intent as string | undefined,
        step_summary: structuredOutput.step_summary as string | undefined,
        events_that_happened: structuredOutput.events_that_happened as string | undefined,
        how_content_changed: structuredOutput.how_content_changed as string | undefined,
        results_if_any: structuredOutput.results_if_any as string | undefined,
        what_was_clicked: structuredOutput.what_was_clicked as string | undefined,
        what_was_typed: structuredOutput.what_was_typed as string | undefined,
        created_at: annotation.created_at as string
      };
    });

    // 5. Generate YAML export with context-aware comments
    console.log('🔄 Generating YAML export...');
    const workflowTitle = selectedWorkflowName || targetWorkflow.title || 'Exported Workflow';
    const exportData = generateWorkflowYAML(
      workflowTitle,
      targetWorkflow,
      annotations,
      synthesisContext,
      savedSynthesis
    );

    console.log(`✅ Generated YAML export for workflow: ${workflowTitle}`);

    return NextResponse.json({
      success: true,
      filename: `${workflowTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_workflow.yaml`,
      content: exportData,
      metadata: {
        workflowId: targetWorkflow.id,
        workflowTitle,
        annotationsCount: annotations.length,
        hasContext: !!synthesisContext,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in workflow export:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

function generateWorkflowYAML(
  workflowTitle: string,
  workflow: WorkflowData,
  annotations: TimelineAnnotation[],
  context: WorkflowContext | null,
  savedSynthesis: SavedSynthesis | null
): string {
  // Extract variables from annotations
  const variables = extractVariables(annotations);
  const steps = generateStepsFromAnnotations(annotations);
  const selectors = generateSelectorsFromAnnotations(annotations);

  // Build the workflow structure based on example format
  const workflowData = {
    // Header comment will be added manually
    tool_name: "execute_sequence",
    arguments: {
      variables,
      inputs: generateDefaultInputs(variables),
      selectors,
      steps
    }
  };

  // Generate YAML with custom comments
  const yamlContent = generateYAMLWithComments(workflowData, workflowTitle, context, savedSynthesis, annotations.length);

  return yamlContent;
}

function extractVariables(annotations: TimelineAnnotation[]): Record<string, VariableDefinition> {
  const variables: Record<string, VariableDefinition> = {};

  // Add URL variable (common in most workflows)
  variables.url = {
    type: "string",
    label: "Target URL", 
    description: "The URL where this workflow will be executed.",
    default: "https://example.com"
  };

  // Extract input fields from annotations
  const inputFields = new Set<string>();
  annotations.forEach(annotation => {
    if (annotation.what_was_typed) {
      // Try to identify common input types
      const typed = annotation.what_was_typed.toLowerCase();
      if (typed.includes('@') && typed.includes('.')) {
        inputFields.add('email');
      } else if (/^\d+$/.test(typed)) {
        inputFields.add('numeric_value');
      } else if (typed.length > 0) {
        inputFields.add('text_input');
      }
    }
  });

  // Add detected input fields as variables
  inputFields.forEach(fieldType => {
    switch (fieldType) {
      case 'email':
        variables.user_email = {
          type: "string",
          label: "User Email",
          description: "Email address for the workflow.",
          default: "user@example.com",
          regex: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
          validation_message: "Please enter a valid email address."
        };
        break;
      case 'numeric_value':
        variables.numeric_input = {
          type: "string",
          label: "Numeric Input",
          description: "Numeric value required for the workflow.",
          default: "100",
          regex: "^\\d+$",
          validation_message: "Must be a number."
        };
        break;
      case 'text_input':
        variables.text_input = {
          type: "string",
          label: "Text Input", 
          description: "Text value required for the workflow.",
          default: "Sample Text"
        };
        break;
    }
  });

  return variables;
}

function generateStepsFromAnnotations(annotations: TimelineAnnotation[]): WorkflowStepGroup[] {
  const steps: WorkflowStepGroup[] = [];

  // Group annotations into logical steps
  const stepGroups = groupAnnotationsByIntent(annotations);

  stepGroups.forEach((group, index) => {
    const groupName = group.name || `Step ${index + 1}`;
    const stepGroup = {
      group_name: groupName,
      skippable: false,
      steps: group.annotations.map(annotation => generateStepFromAnnotation(annotation))
    };

    steps.push(stepGroup);
  });

  // Add a final capture step if we have UI interactions
  if (annotations.some(a => a.what_was_clicked || a.what_was_typed)) {
    steps.push({
      group_name: "Capture Results",
      skippable: false,
      steps: [{
        tool_name: "get_focused_window_tree",
        arguments: {}
      }]
    });
  }

  return steps;
}

function groupAnnotationsByIntent(annotations: TimelineAnnotation[]): Array<{name: string, annotations: TimelineAnnotation[]}> {
  const groups: Array<{name: string, annotations: TimelineAnnotation[]}> = [];
  let currentGroup: {name: string, annotations: TimelineAnnotation[]} | null = null;

  annotations.forEach(annotation => {
    const intent = annotation.user_intent || annotation.step_title || 'Unknown Action';
    
    if (!currentGroup || !isSimilarIntent(currentGroup.name, intent)) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        name: intent,
        annotations: [annotation]
      };
    } else {
      currentGroup.annotations.push(annotation);
    }
  });

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

function isSimilarIntent(intent1: string, intent2: string): boolean {
  // Simple similarity check - could be enhanced
  const words1 = intent1.toLowerCase().split(/\s+/);
  const words2 = intent2.toLowerCase().split(/\s+/);
  const commonWords = words1.filter(word => words2.includes(word));
  return commonWords.length > 0;
}

function generateStepFromAnnotation(annotation: TimelineAnnotation): WorkflowStep {
  // Generate appropriate tool based on the annotation
  if (annotation.what_was_clicked) {
    return {
      tool_name: "click_element",
      arguments: {
        selector: `role:button|name:${annotation.what_was_clicked}`,
        timeout_ms: 1000,
        include_tree: false
      }
    };
  } else if (annotation.what_was_typed) {
    return {
      tool_name: "set_value",
      arguments: {
        selector: "role:edit",
        value: `{{${getVariableForInput(annotation.what_was_typed)}}}`,
        timeout_ms: 500,
        include_tree: false
      }
    };
  } else {
    return {
      tool_name: "wait_for_element",
      arguments: {
        selector: "role:any",
        condition: "exists",
        timeout_ms: 2000,
        include_tree: false
      }
    };
  }
}

function getVariableForInput(typedText: string): string {
  if (typedText.includes('@')) return 'user_email';
  if (/^\d+$/.test(typedText)) return 'numeric_input';
  return 'text_input';
}

function generateSelectorsFromAnnotations(annotations: TimelineAnnotation[]): Record<string, string> {
  const selectors: Record<string, string> = {};

  // Add common selectors
  selectors.main_window = "role:Window";
  
  // Extract selectors from clicked elements
  annotations.forEach((annotation, index) => {
    if (annotation.what_was_clicked) {
      const selectorName = `element_${index + 1}`;
      selectors[selectorName] = `role:button|name:${annotation.what_was_clicked}`;
    }
  });

  return selectors;
}

function generateDefaultInputs(variables: Record<string, VariableDefinition>): Record<string, string> {
  const inputs: Record<string, string> = {};
  
  Object.keys(variables).forEach(key => {
    inputs[key] = variables[key].default;
  });

  return inputs;
}

function generateYAMLWithComments(
  workflowData: WorkflowYAMLData,
  title: string,
  context: WorkflowContext | null,
  savedSynthesis: SavedSynthesis | null,
  annotationsCount: number
): string {
  let yaml_content = `---
# Workflow: ${title}
# Generated from recorded user interactions and timeline mapping
# 
# Context Information:
# - Project: ${context?.project_name || 'Unknown'}
# - User Role: ${context?.user_job_role || 'Unknown'}
# - Goal: ${context?.user_goal_from_recordings || 'Not specified'}
# - Project Goal: ${context?.overall_project_goal || 'Not specified'}
# - Timeline Events: ${annotationsCount} mapped events
# - Generated: ${new Date().toISOString()}
#
# This workflow was automatically generated from user activity recordings.
# Review and customize the selectors, variables, and steps as needed.

`;

  // Add the main workflow YAML
  yaml_content += yaml.dump(workflowData, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false
  });

  return yaml_content;
} 