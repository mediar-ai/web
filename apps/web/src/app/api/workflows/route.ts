import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

interface DetailedSynthesizedWorkflow {
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
}

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

interface EnhancedWorkflowData extends DetailedSynthesizedWorkflow {
  workflow_components_with_ids: {
    workflow_types: WorkflowComponentWithId[];
    workflow_instances: WorkflowInstanceWithId[];
    steps: WorkflowStepWithId[];
  };
}

// Generate unique IDs for workflow components
function generateComponentIds(workflow: DetailedSynthesizedWorkflow): EnhancedWorkflowData {
  let currentId = Date.now(); // Start with timestamp for uniqueness
  
  // Generate IDs for workflow types
  const workflowTypesWithIds: WorkflowComponentWithId[] = workflow.workflow_types.map(type => ({
    id: ++currentId,
    type_name: type.type_name,
    type_description: type.type_description,
    conditions: type.conditions
  }));

  // Generate IDs for workflow instances
  const workflowInstancesWithIds: WorkflowInstanceWithId[] = workflow.workflow_instances.map(instance => ({
    id: ++currentId,
    instance_name: instance.instance_name,
    instance_data: instance.instance_data
  }));

  // Generate IDs for steps and substeps
  const stepsWithIds: WorkflowStepWithId[] = workflow.steps.map(step => {
    const substepsWithIds: WorkflowSubstepWithId[] = step.substeps.map(substep => ({
      id: ++currentId,
      substep_name: substep.substep_name,
      inputs: substep.inputs,
      outputs: substep.outputs,
      business_logic: substep.business_logic
    }));

    return {
      id: ++currentId,
      step_name: step.step_name,
      substeps: substepsWithIds
    };
  });

  return {
    ...workflow,
    workflow_components_with_ids: {
      workflow_types: workflowTypesWithIds,
      workflow_instances: workflowInstancesWithIds,
      steps: stepsWithIds
    }
  };
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { userId, workflows } = await req.json();

  if (!userId || !workflows || !Array.isArray(workflows)) {
    return NextResponse.json({ error: 'Missing userId or workflows array' }, { status: 400 });
  }

  try {
    const enhancedWorkflows = [];

    for (const workflow of workflows) {
      // Generate component IDs if detailed_workflow_data exists
      let enhancedWorkflowData = workflow.detailed_workflow_data;
      if (workflow.detailed_workflow_data) {
        enhancedWorkflowData = generateComponentIds(workflow.detailed_workflow_data);
        console.log(`[DB] Generated component IDs for workflow: ${workflow.title}`);
      }

      // Create the workflow record with enhanced data
      const recordToInsert = {
        ...workflow,
        user_id: userId,
        detailed_workflow_data: enhancedWorkflowData
      };

      const { data: savedWorkflows, error: workflowError } = await supabase
        .from('low_level_workflows')
        .insert([recordToInsert])
        .select();

      if (workflowError) throw workflowError;

      const savedWorkflow = savedWorkflows[0];
      enhancedWorkflows.push(savedWorkflow);
    }

    console.log(`[SUCCESS] Successfully saved ${enhancedWorkflows.length} workflows with component IDs`);
    return NextResponse.json({ success: true, data: enhancedWorkflows });

  } catch (error) {
    console.error('Error creating workflow:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  const synthesisSessionId = searchParams.get('synthesis_session_id');
  const status = searchParams.get('status'); // 'draft', 'saved', 'archived'

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  try {
    // Start with base query
    let query = supabase
      .from('low_level_workflows')
      .select('*')
      .eq('user_id', userId);

    // Apply synthesis session filter if provided
    if (synthesisSessionId) {
      // Convert string to number for proper comparison with bigint column
      const sessionIdNumber = parseInt(synthesisSessionId, 10);
      if (!isNaN(sessionIdNumber)) {
        query = query.eq('synthesis_session_id', sessionIdNumber);
      }
    }

    // Apply status filter if provided
    if (status) {
      query = query.eq('synthesis_status', status);
    }

    // Order by most recent first
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('Error fetching workflows:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
} 