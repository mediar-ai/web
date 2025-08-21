import * as yaml from 'js-yaml';

export interface TimelineAnnotation {
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

export interface WorkflowContext {
  user_job_role: string;
  project_name: string;
  user_goal_from_recordings: string;
  overall_project_goal: string;
  overall_project_description: string;
  user_instructions?: string;
}

export interface SavedSynthesis {
  id: number;
  title: string;
  workflow_context: WorkflowContext;
  synthesis_process_data: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowData {
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

export interface ExampleWorkflow {
  id: number;
  name: string;
  automation_sequence_yaml: string | null;
  automation_sequence: Record<string, unknown> | null;
  sequence_format: string;
  version: string;
}

/**
 * Enhanced context gathering that combines all available sources
 */
export function gatherComprehensiveContext(
  workflow: WorkflowData,
  annotations: TimelineAnnotation[],
  context: WorkflowContext | null,
  savedSynthesis: SavedSynthesis | null,
  exampleWorkflows: ExampleWorkflow[]
): {
  projectContext: string;
  workflowDescription: string;
  stepDescriptions: Array<{
    title: string;
    description: string;
    userIntent: string;
    businessLogic: string[];
    inputs: string[];
    outputs: string[];
  }>;
  variableContext: Record<string, {
    source: string;
    confidence: number;
    examples: string[];
  }>;
} {
  console.log('🔄 Gathering comprehensive context for workflow export...');

  // 1. Project Context
  const projectContext = buildProjectContext(context);

  // 2. Workflow Description
  const workflowDescription = buildWorkflowDescription(workflow, context, annotations);

  // 3. Step Descriptions from timeline annotations
  const stepDescriptions = buildStepDescriptions(annotations);

  // 4. Variable Context from annotations and examples
  const variableContext = buildVariableContext(annotations, exampleWorkflows);

  console.log(`[SUCCESS] Context gathered: ${stepDescriptions.length} steps, ${Object.keys(variableContext).length} variables`);

  return {
    projectContext,
    workflowDescription,
    stepDescriptions,
    variableContext
  };
}

function buildProjectContext(
  context: WorkflowContext | null
): string {
  const parts: string[] = [];

  if (context?.project_name) {
    parts.push(`Project: ${context.project_name}`);
  }

  if (context?.user_job_role) {
    parts.push(`User Role: ${context.user_job_role}`);
  }

  if (context?.overall_project_goal) {
    parts.push(`Project Goal: ${context.overall_project_goal}`);
  }

  if (context?.user_goal_from_recordings) {
    parts.push(`Specific Goal: ${context.user_goal_from_recordings}`);
  }

  if (context?.overall_project_description) {
    parts.push(`Description: ${context.overall_project_description}`);
  }

  return parts.join(' | ');
}

function buildWorkflowDescription(
  workflow: WorkflowData,
  context: WorkflowContext | null,
  annotations: TimelineAnnotation[]
): string {
  const parts: string[] = [];

  if (workflow.title) {
    parts.push(`Workflow: ${workflow.title}`);
  }

  // Add business logic if available
  if (workflow.business_logic && workflow.business_logic.length > 0) {
    parts.push(`Business Logic: ${workflow.business_logic.join(', ')}`);
  }

  // Add high-level description from context
  if (context?.user_goal_from_recordings) {
    parts.push(`Purpose: ${context.user_goal_from_recordings}`);
  }

  // Add step count and complexity
  const uniqueIntents = [...new Set(annotations.map(a => a.user_intent).filter(Boolean))];
  if (uniqueIntents.length > 0) {
    parts.push(`Contains ${uniqueIntents.length} distinct user actions`);
  }

  return parts.join(' - ');
}

function buildStepDescriptions(annotations: TimelineAnnotation[]): Array<{
  title: string;
  description: string;
  userIntent: string;
  businessLogic: string[];
  inputs: string[];
  outputs: string[];
}> {
  // Group annotations by similar intent/step
  const stepGroups = groupAnnotationsByIntent(annotations);

  return stepGroups.map(group => ({
    title: group.name,
    description: group.annotations
      .map(a => a.step_summary)
      .filter(Boolean)
      .join('. '),
    userIntent: group.annotations
      .map(a => a.user_intent)
      .filter(Boolean)[0] || '',
    businessLogic: [...new Set(
      group.annotations
        .flatMap(a => a.business_logic || [])
        .filter(Boolean)
    )],
    inputs: [...new Set(
      group.annotations
        .flatMap(a => a.inputs || [])
        .filter(Boolean)
    )],
    outputs: [...new Set(
      group.annotations
        .flatMap(a => a.outputs || [])
        .filter(Boolean)
    )]
  }));
}

function groupAnnotationsByIntent(annotations: TimelineAnnotation[]): Array<{
  name: string;
  annotations: TimelineAnnotation[];
}> {
  const groups: Array<{name: string; annotations: TimelineAnnotation[]}> = [];
  let currentGroup: {name: string; annotations: TimelineAnnotation[]} | null = null;

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
  const words1 = intent1.toLowerCase().split(/\s+/);
  const words2 = intent2.toLowerCase().split(/\s+/);
  const commonWords = words1.filter(word => words2.includes(word));
  return commonWords.length > 0;
}

function buildVariableContext(
  annotations: TimelineAnnotation[],
  exampleWorkflows: ExampleWorkflow[]
): Record<string, {
  source: string;
  confidence: number;
  examples: string[];
}> {
  const variableContext: Record<string, {
    source: string;
    confidence: number;
    examples: string[];
  }> = {};

  // Extract variables from typed inputs
  annotations.forEach(annotation => {
    if (annotation.what_was_typed) {
      const typed = annotation.what_was_typed;
      let varType: string;
      let confidence = 0.8;

      if (typed.includes('@') && typed.includes('.')) {
        varType = 'email';
      } else if (/^\d+$/.test(typed)) {
        varType = 'numeric_value';
      } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(typed)) {
        varType = 'date';
        confidence = 0.9;
      } else if (typed.length > 0) {
        varType = 'text_input';
      } else {
        return;
      }

      if (!variableContext[varType]) {
        variableContext[varType] = {
          source: 'timeline_annotations',
          confidence,
          examples: []
        };
      }

      if (!variableContext[varType].examples.includes(typed)) {
        variableContext[varType].examples.push(typed);
      }
    }
  });

  // Extract common patterns from example workflows
  exampleWorkflows.forEach(example => {
    if (example.automation_sequence_yaml) {
      try {
                 const parsed = yaml.load(example.automation_sequence_yaml) as Record<string, unknown>;
         const variables = (parsed?.arguments as Record<string, unknown>)?.variables as Record<string, unknown> || {};
        
        Object.keys(variables).forEach(varName => {
          const varData = variables[varName] as Record<string, unknown>;
          if (varData && typeof varData === 'object' && varData.type && varData.default) {
            if (!variableContext[varName]) {
              variableContext[varName] = {
                source: 'example_workflows',
                confidence: 0.6,
                examples: []
              };
            }
            
            if (!variableContext[varName].examples.includes(varData.default as string)) {
              variableContext[varName].examples.push(varData.default as string);
            }
          }
        });
      } catch (error) {
        console.warn('Failed to parse example workflow YAML:', error);
      }
    }
  });

  return variableContext;
}

/**
 * Generate enhanced YAML with comprehensive context
 */
export function generateEnhancedWorkflowYAML(
  workflowTitle: string,
  workflow: WorkflowData,
  annotations: TimelineAnnotation[],
  context: WorkflowContext | null,
  savedSynthesis: SavedSynthesis | null,
  exampleWorkflows: ExampleWorkflow[]
): string {
  console.log('🔄 Generating enhanced workflow YAML...');

  // Gather comprehensive context
  const comprehensiveContext = gatherComprehensiveContext(
    workflow, annotations, context, savedSynthesis, exampleWorkflows
  );

  // Generate variables with context
  const variables = generateEnhancedVariables(comprehensiveContext.variableContext);
  
  // Generate steps with enhanced context
  const steps = generateEnhancedSteps(comprehensiveContext.stepDescriptions, annotations);
  
  // Generate selectors
  const selectors = generateEnhancedSelectors(annotations);

  // Build the workflow structure
  const workflowData = {
    tool_name: "execute_sequence",
    arguments: {
      variables,
      inputs: generateDefaultInputs(variables),
      selectors,
      steps
    }
  };

  // Generate YAML with enhanced comments
  const yamlContent = generateEnhancedYAMLWithComments(
    workflowData,
    workflowTitle,
    comprehensiveContext,
    annotations.length
  );

  console.log('[SUCCESS] Enhanced YAML generated successfully');
  return yamlContent;
}

function generateEnhancedVariables(
  variableContext: Record<string, {source: string; confidence: number; examples: string[]}>
): Record<string, Record<string, unknown>> {
  const variables: Record<string, Record<string, unknown>> = {};

  // Always include URL
  variables.url = {
    type: "string",
    label: "Target URL",
    description: "The URL where this workflow will be executed.",
    default: "https://example.com"
  };

  // Add variables based on context
  Object.entries(variableContext).forEach(([varType, varInfo]) => {
    const example = varInfo.examples[0] || '';
    
    switch (varType) {
      case 'email':
        variables.user_email = {
          type: "string",
          label: "User Email",
          description: "Email address for the workflow.",
          default: example || "user@example.com",
          regex: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
          validation_message: "Please enter a valid email address."
        };
        break;
      case 'numeric_value':
        variables.numeric_input = {
          type: "string",
          label: "Numeric Input",
          description: "Numeric value required for the workflow.",
          default: example || "100",
          regex: "^\\d+$",
          validation_message: "Must be a number."
        };
        break;
      case 'date':
        variables.date_input = {
          type: "string",
          label: "Date Input",
          description: "Date in MM/DD/YYYY format.",
          default: example || "01/01/2024",
          regex: "(0[1-9]|1[0-2])\\/(0[1-9]|[12][0-9]|3[01])\\/\\d{4}",
          validation_message: "Date must be in MM/DD/YYYY format."
        };
        break;
      case 'text_input':
        variables.text_input = {
          type: "string",
          label: "Text Input",
          description: "Text value required for the workflow.",
          default: example || "Sample Text"
        };
        break;
    }
  });

  return variables;
}

function generateEnhancedSteps(
  stepDescriptions: Array<{
    title: string;
    description: string;
    userIntent: string;
    businessLogic: string[];
    inputs: string[];
    outputs: string[];
  }>,
  annotations: TimelineAnnotation[]
): Array<Record<string, unknown>> {
  const steps: Array<Record<string, unknown>> = [];

  // Navigate to URL step
  steps.push({
    tool_name: "navigate_browser",
    arguments: {
      url: "{{url}}"
    }
  });

  // Generate steps from descriptions
  stepDescriptions.forEach((stepDesc) => {
    const stepGroup: Record<string, unknown> = {
      group_name: stepDesc.title,
      skippable: false,
      steps: []
    };

    // Add comment about the step if we have business logic or description
    if (stepDesc.description || stepDesc.businessLogic.length > 0) {
      const comments: string[] = [];
      if (stepDesc.description) {
        comments.push(`Description: ${stepDesc.description}`);
      }
      if (stepDesc.businessLogic.length > 0) {
        comments.push(`Business Logic: ${stepDesc.businessLogic.join(', ')}`);
      }
      (stepGroup as Record<string, unknown>)._comment = comments.join(' | ');
    }

    // Find annotations for this step
    const stepAnnotations = annotations.filter(a => 
      a.user_intent === stepDesc.userIntent || a.step_title === stepDesc.title
    );

    const stepActions: Array<Record<string, unknown>> = [];
    stepAnnotations.forEach(annotation => {
      if (annotation.what_was_clicked) {
        stepActions.push({
          tool_name: "click_element",
          arguments: {
            selector: `role:button|name:${annotation.what_was_clicked}`,
            timeout_ms: 1000,
            include_tree: false
          }
        });
      } else if (annotation.what_was_typed) {
        stepActions.push({
          tool_name: "set_value",
          arguments: {
            selector: "role:edit",
            value: `{{${getVariableForInput(annotation.what_was_typed)}}}`,
            timeout_ms: 500,
            include_tree: false
          }
        });
      }
    });

    if (stepActions.length === 0) {
      stepActions.push({
        tool_name: "wait_for_element",
        arguments: {
          selector: "role:any",
          condition: "exists",
          timeout_ms: 2000,
          include_tree: false
        }
      });
    }

    stepGroup.steps = stepActions;
    steps.push(stepGroup);
  });

  // Add final capture step
  steps.push({
    group_name: "Capture Results",
    skippable: false,
    steps: [{
      tool_name: "get_focused_window_tree",
      arguments: {}
    }]
  });

  return steps;
}

function generateEnhancedSelectors(annotations: TimelineAnnotation[]): Record<string, string> {
  const selectors: Record<string, string> = {};

  selectors.main_window = "role:Window";
  
  // Add selectors from clicked elements
  const clickedElements = [...new Set(
    annotations
      .map(a => a.what_was_clicked)
      .filter(Boolean)
  )];

  clickedElements.forEach((element) => {
    const selectorName = `${element!.toLowerCase().replace(/\s+/g, '_')}_button`;
    selectors[selectorName] = `role:button|name:${element}`;
  });

  return selectors;
}

function getVariableForInput(typedText: string): string {
  if (typedText.includes('@')) return 'user_email';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(typedText)) return 'date_input';
  if (/^\d+$/.test(typedText)) return 'numeric_input';
  return 'text_input';
}

function generateDefaultInputs(variables: Record<string, Record<string, unknown>>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  
  Object.keys(variables).forEach(key => {
    const variable = variables[key];
    inputs[key] = variable.default;
  });

  return inputs;
}

function generateEnhancedYAMLWithComments(
  workflowData: Record<string, unknown>,
  title: string,
  context: {
    projectContext: string;
    workflowDescription: string;
    stepDescriptions: Array<{
      title: string;
      description: string;
      userIntent: string;
      businessLogic: string[];
      inputs: string[];
      outputs: string[];
    }>;
    variableContext: Record<string, {
      source: string;
      confidence: number;
      examples: string[];
    }>;
  },
  annotationsCount: number
): string {
  const yamlContent = `---
# Workflow: ${title}
# Generated from recorded user interactions and timeline mapping
# 
# Context Information:
# - ${context.projectContext}
# - ${context.workflowDescription}
# - Timeline Events: ${annotationsCount} mapped events
# - Generated: ${new Date().toISOString()}
#
# Step Overview:
${context.stepDescriptions.map((step, i) => `#   ${i + 1}. ${step.title}${step.description ? ` - ${step.description}` : ''}`).join('\n')}
#
# Variable Sources:
${Object.entries(context.variableContext).map(([name, info]) => `#   ${name}: ${info.source} (confidence: ${Math.round(info.confidence * 100)}%)`).join('\n')}
#
# This workflow was automatically generated from user activity recordings.
# Review and customize the selectors, variables, and steps as needed.

${yaml.dump(workflowData, {
  indent: 2,
  lineWidth: 120,
  noRefs: true,
  sortKeys: false
})}`;

  return yamlContent;
} 