import { WORKFLOW_EXPORT_ENHANCEMENT_PROMPT } from '@/lib/prompts';
import { getVertexAIModel } from '@/lib/vertexai';
import { generateEnhancedWorkflowYAML } from '@/lib/workflowExportHelpers';
import { createClient } from '@supabase/supabase-js';
import * as yaml from 'js-yaml';
import { NextRequest, NextResponse } from 'next/server';

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
  workflow_context: Record<string, unknown> | null;
  chat_history: Record<string, unknown> | null;
  synthesis_status: string | null;
}

interface ExampleWorkflow {
  id: number;
  name: string;
  automation_sequence_yaml: string | null;
  automation_sequence: Record<string, unknown> | null;
  sequence_format: string;
  version: string;
  category: string;
}

/**
 * Fetch latest deployed workflows as examples for YAML generation
 */
async function fetchSampleWorkflows(): Promise<ExampleWorkflow[]> {
  console.log('📋 [EXPORT] Fetching sample workflows from deployed_workflows...');
  const startTime = Date.now();
  
  const { data: workflows, error } = await supabaseAdmin
    .from('deployed_workflows_with_sequence')
    .select(`
      id,
      name,
      automation_sequence_yaml,
      automation_sequence,
      preferred_format,
      version,
      category,
      created_at
    `)
    .eq('status', 'deployed')
    .order('created_at', { ascending: false })
    .limit(3); // Get latest 3 workflows as examples

  const fetchTime = Date.now() - startTime;

  if (error) {
    console.warn('⚠️ [EXPORT] Warning: Could not fetch sample workflows:', {
      error: error.message,
      code: error.code,
      details: error.details,
      fetchTimeMs: fetchTime
    });
    return [];
  }

  // Transform to match expected interface
  const transformedWorkflows = (workflows || []).map(w => ({
    id: w.id,
    name: w.name,
    automation_sequence_yaml: w.automation_sequence_yaml,
    automation_sequence: w.automation_sequence,
    sequence_format: w.preferred_format || 'yaml',
    version: w.version,
    category: w.category
  }));

  console.log('✅ [EXPORT] Sample workflows fetched successfully:', {
    count: transformedWorkflows.length,
    fetchTimeMs: fetchTime,
    workflows: transformedWorkflows.map(w => ({
      id: w.id,
      name: w.name,
      version: w.version,
      category: w.category,
      hasYaml: !!w.automation_sequence_yaml,
      hasSequence: !!w.automation_sequence
    }))
  });

  return transformedWorkflows;
}

/**
 * Generate enhanced context using LLM with sample workflows
 */
async function generateEnhancedExportWithLLM(
  workflowTitle: string,
  targetWorkflow: WorkflowData,
  annotations: TimelineAnnotation[],
  context: WorkflowContext | null,
  savedSynthesis: SavedSynthesis | null,
  sampleWorkflows: ExampleWorkflow[]
): Promise<string> {
  console.log('🤖 [EXPORT] Starting enhanced export with Gemini LLM...');
  const startTime = Date.now();

  // Prepare context for LLM
  const llmContext = {
    targetWorkflow: {
      title: workflowTitle,
      id: targetWorkflow.id,
      steps: steps,
      inputs: inputs,
      outputs: outputs,
      businessLogic: (workflowDetails as any)?.business_logic || []
    },
    userContext: context ? {
      userRole: context.user_job_role,
      projectName: context.project_name,
      userGoal: context.user_goal_from_recordings,
      projectGoal: context.overall_project_goal,
      projectDescription: context.overall_project_description
    } : null,
    timelineAnnotations: annotations.map(ann => ({
      stepTitle: ann.step_title,
      userIntent: ann.user_intent,
      stepSummary: ann.step_summary,
      inputs: ann.inputs,
      outputs: ann.outputs,
      businessLogic: ann.business_logic,
      eventsHappened: ann.events_that_happened,
      whatWasClicked: ann.what_was_clicked,
      whatWasTyped: ann.what_was_typed
    })),
    sampleWorkflows: sampleWorkflows.map(sample => ({
      name: sample.name,
      category: sample.category,
      version: sample.version,
      automationSequenceYaml: sample.automation_sequence_yaml,
      automationSequence: sample.automation_sequence
    }))
  };

  console.log('📊 [EXPORT] LLM context prepared:', {
    targetWorkflowId: targetWorkflow.id,
    targetWorkflowTitle: workflowTitle,
    hasUserContext: !!context,
    annotationsCount: annotations.length,
    sampleWorkflowsCount: sampleWorkflows.length,
    contextSize: JSON.stringify(llmContext).length
  });

  try {
    const model = getVertexAIModel('gemini-2.5-pro');
    
    const prompt = `${WORKFLOW_EXPORT_ENHANCEMENT_PROMPT}

**Context Data:**
${JSON.stringify(llmContext, null, 2)}

Please generate an enhanced YAML workflow sequence based on this data and the sample workflows provided.`;

    console.log('🤖 [EXPORT] Calling Vertex AI with context data...', {
      model: 'gemini-2.5-pro',
      promptLength: prompt.length,
      temperature: 0.3
    });

    const llmStartTime = Date.now();
    const result = await model.generateContent({ 
      contents: [{ role: "user", parts: [{ text: prompt }] }], 
      generationConfig: { temperature: 0.3 }
    });

    const llmTime = Date.now() - llmStartTime;
    const response = result.response;
    
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const enhancedYaml = response.candidates[0].content.parts[0].text;
      const totalTime = Date.now() - startTime;
      
      console.log('✅ [EXPORT] Enhanced YAML generated successfully with LLM:', {
        llmResponseTimeMs: llmTime,
        totalTimeMs: totalTime,
        outputLength: enhancedYaml.length,
        hasOutput: !!enhancedYaml.trim()
      });
      
      return enhancedYaml.trim();
    }

    throw new Error('No valid response from Vertex AI model');

  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error('❌ [EXPORT] LLM enhancement failed, falling back to basic generation:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      errorTimeMs: errorTime,
      fallbackUsed: true
    });
    
    // Fallback to enhanced generation without LLM
    console.log('🔄 [EXPORT] Using fallback enhanced generation...');
    return generateEnhancedWorkflowYAML(
      workflowTitle,
      targetWorkflow,
      annotations,
      context,
      savedSynthesis,
      sampleWorkflows
    );
  }
}

export async function POST(req: NextRequest) {
  const requestStartTime = Date.now();
  let requestId = `export_request_${Date.now()}`; // Default ID in case of early error
  
  try {
    const requestBody = await req.json();
    const { userId, workflowId, selectedWorkflowName }: WorkflowExportRequest = requestBody;

    // Generate a more specific request ID now that we have workflowId
    requestId = `export_${workflowId}_${Date.now()}`;

    console.log('🚀 [EXPORT] Starting enhanced workflow export request:', {
      requestId,
      userId,
      workflowId,
      selectedWorkflowName,
      timestamp: new Date().toISOString()
    });

    if (!userId || !workflowId) {
      console.error('❌ [EXPORT] Missing required parameters:', {
        requestId,
        hasUserId: !!userId,
        hasWorkflowId: !!workflowId
      });
      return NextResponse.json({ error: 'Missing userId or workflowId' }, { status: 400 });
    }

    console.log(`🔄 [EXPORT] Starting enhanced workflow export for user ${userId}, workflow ${workflowId}`, {
      requestId
    });

    // 1. Fetch sample workflows for context
    console.log('📋 [EXPORT] Step 1: Fetching sample workflows for context...', { requestId });
    const sampleWorkflows = await fetchSampleWorkflows();

    // 2. Get specific workflow details
    console.log(`📋 [EXPORT] Step 2: Fetching workflow details for ID ${workflowId}...`, { requestId });
    const workflowFetchStart = Date.now();
    
    const { data: targetWorkflow, error: workflowError } = await supabaseAdmin
      .from('low_level_workflows')
      .select(`
        id, 
        title, 
        detailed_workflow_data, 
        synthesis_session_id,
        created_at,
        workflow_context,
        chat_history,
        synthesis_status
      `)
      .eq('id', workflowId)
      .eq('user_id', userId)
      .single() as { data: WorkflowData | null; error: unknown };

    const workflowFetchTime = Date.now() - workflowFetchStart;

    if (workflowError || !targetWorkflow) {
      console.error('❌ [EXPORT] Workflow not found:', {
        requestId,
        workflowId,
        userId,
        error: workflowError,
        fetchTimeMs: workflowFetchTime
      });
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Extract workflow data from detailed_workflow_data if available
    const workflowDetails = targetWorkflow.detailed_workflow_data || {};
    const steps = (workflowDetails as any)?.steps || [];
    const inputs = (workflowDetails as any)?.inputs || [];
    const outputs = (workflowDetails as any)?.outputs || [];
    
    console.log('✅ [EXPORT] Target workflow fetched successfully:', {
      requestId,
      workflowId: targetWorkflow.id,
      workflowTitle: targetWorkflow.title,
      hasSynthesisSession: !!targetWorkflow.synthesis_session_id,
      hasSteps: !!steps?.length,
      hasInputs: !!inputs?.length,
      hasOutputs: !!outputs?.length,
      fetchTimeMs: workflowFetchTime
    });

    // 3. Get saved synthesis data for context
    console.log('📋 [EXPORT] Step 3: Fetching synthesis context...', { requestId });
    const synthesisStart = Date.now();
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

      const synthesisTime = Date.now() - synthesisStart;

      if (!synthesisError && synthesis) {
        savedSynthesis = synthesis;
        synthesisContext = synthesis.workflow_context;
        
        console.log('✅ [EXPORT] Synthesis context found:', {
          requestId,
          synthesisId: synthesis.id,
          synthesisTitle: synthesis.title,
          hasWorkflowContext: !!synthesis.workflow_context,
          fetchTimeMs: synthesisTime
        });
      } else {
        console.log('⚠️ [EXPORT] No synthesis context found:', {
          requestId,
          synthesisSessionId: targetWorkflow.synthesis_session_id,
          error: synthesisError?.message,
          fetchTimeMs: synthesisTime
        });
      }
    } else {
      console.log('ℹ️ [EXPORT] No synthesis session ID - skipping synthesis context fetch', {
        requestId
      });
    }

    // 4. Get timeline mapping data for this workflow
    console.log('📋 [EXPORT] Step 4: Fetching timeline annotations...', { requestId });
    const annotationsStart = Date.now();
    
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

    const annotationsTime = Date.now() - annotationsStart;

    if (timelineError) {
      console.warn('⚠️ [EXPORT] Error fetching timeline annotations:', {
        requestId,
        error: timelineError.message,
        code: timelineError.code,
        fetchTimeMs: annotationsTime
      });
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

    console.log('✅ [EXPORT] Timeline annotations processed:', {
      requestId,
      rawAnnotationsCount: timelineAnnotations?.length || 0,
      processedAnnotationsCount: annotations.length,
      annotationsWithStepTitle: annotations.filter(a => a.step_title).length,
      annotationsWithUserIntent: annotations.filter(a => a.user_intent).length,
      annotationsWithClicks: annotations.filter(a => a.what_was_clicked).length,
      annotationsWithTyping: annotations.filter(a => a.what_was_typed).length,
      fetchTimeMs: annotationsTime
    });

    // 5. Generate YAML export with context-aware comments
    console.log('🔄 [EXPORT] Step 5: Generating enhanced YAML export...', { requestId });
    const exportStart = Date.now();
    const workflowTitle = selectedWorkflowName || targetWorkflow.title || 'Exported Workflow';
    
    const exportData = await generateEnhancedExportWithLLM(
      workflowTitle,
      targetWorkflow,
      annotations,
      synthesisContext,
      savedSynthesis,
      sampleWorkflows
    );

    const exportTime = Date.now() - exportStart;
    const totalTime = Date.now() - requestStartTime;

    console.log(`✅ [EXPORT] YAML export generation completed successfully:`, {
      requestId,
      workflowTitle,
      workflowId: targetWorkflow.id,
      outputLength: exportData.length,
      exportTimeMs: exportTime,
      totalRequestTimeMs: totalTime,
      filename: `${workflowTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_workflow.yaml`
    });

    const responseData = {
      success: true,
      filename: `${workflowTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_workflow.yaml`,
      content: exportData,
      metadata: {
        requestId,
        workflowId: targetWorkflow.id,
        workflowTitle,
        annotationsCount: annotations.length,
        sampleWorkflowsCount: sampleWorkflows.length,
        hasContext: !!synthesisContext,
        processingSummary: {
          totalTimeMs: totalTime,
          workflowFetchTimeMs: workflowFetchTime,
          annotationsFetchTimeMs: annotationsTime,
          exportGenerationTimeMs: exportTime
        },
        createdAt: new Date().toISOString()
      }
    };

    console.log('🎉 [EXPORT] Request completed successfully:', {
      requestId,
      totalTimeMs: totalTime,
      success: true
    });

    return NextResponse.json(responseData);

  } catch (error) {
    const errorTime = Date.now() - requestStartTime;
    const errorDetails = {
      requestId: requestId || 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      stack: error instanceof Error ? error.stack : undefined,
      totalTimeMs: errorTime,
      timestamp: new Date().toISOString()
    };

    console.error('💥 [EXPORT] Request failed with error:', errorDetails);
    
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: errorDetails.error,
      requestId: errorDetails.requestId
    }, { status: 500 });
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