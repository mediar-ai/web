import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Convert pool steps to YAML format
function convertStepsToYaml(steps: any[]): string {
  const yamlSteps = steps.map((step, index) => {
    const stepId = step.step_id || `step_${index + 1}`;
    let yaml = `  - id: ${stepId}\n`;
    yaml += `    tool: ${step.tool_name}\n`;

    if (step.step_name) {
      yaml += `    name: ${step.step_name}\n`;
    }

    if (step.arguments && Object.keys(step.arguments).length > 0) {
      yaml += `    arguments:\n`;
      for (const [key, value] of Object.entries(step.arguments)) {
        if (typeof value === 'object' && value !== null) {
          yaml += `      ${key}: ${JSON.stringify(value)}\n`;
        } else {
          yaml += `      ${key}: ${value}\n`;
        }
      }
    }

    return yaml;
  });

  return `steps:\n${yamlSteps.join('\n')}`;
}

// CORS headers for cross-origin requests from Tauri app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// OPTIONS: Handle CORS preflight requests
export async function OPTIONS(_request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders });
}

// POST: Add selected pool steps to a workflow
export async function POST(request: NextRequest) {
  try {
    // Dual authentication: Desktop token or Clerk session
    let authenticatedUserId: string | null = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import('@/lib/auth/validateDesktopToken');
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
    }

    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.workflow_id || !body.step_ids || !Array.isArray(body.step_ids)) {
      return NextResponse.json(
        { success: false, error: 'workflow_id and step_ids array are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { workflow_id, step_ids, session_id, append_to_workflow = true } = body;

    console.log('[ADD-TO-WORKFLOW] Request:', { workflow_id, step_ids, session_id, user_id: authenticatedUserId });

    // Fetch the selected steps
    const { data: steps, error: fetchError } = await supabase
      .from('user_step_pool')
      .select('*')
      .in('id', step_ids)
      .eq('user_id', authenticatedUserId)
      .eq('status', 'active')
      .order('pool_order', { ascending: true });

    console.log('[ADD-TO-WORKFLOW] Fetched steps:', { count: steps?.length, error: fetchError?.message });

    if (fetchError || !steps || steps.length === 0) {
      console.error('[ADD-TO-WORKFLOW] Failed to fetch steps:', { fetchError, stepsCount: steps?.length });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch pool steps', details: fetchError?.message },
        { status: 404, headers: corsHeaders }
      );
    }

    // Fetch the current workflow
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, automation_sequence, automation_sequence_yaml, version, total_versions')
      .eq('id', workflow_id)
      .single();

    console.log('[ADD-TO-WORKFLOW] Fetched workflow:', { workflow_id, found: !!workflow, error: workflowError?.message });

    if (workflowError || !workflow) {
      console.error('[ADD-TO-WORKFLOW] Workflow not found:', { workflow_id, workflowError });
      return NextResponse.json(
        { success: false, error: 'Workflow not found', details: workflowError?.message },
        { status: 404, headers: corsHeaders }
      );
    }

    // Convert steps to YAML
    const newStepsYaml = convertStepsToYaml(steps);

    let updatedYaml;
    let updatedJson;

    if (append_to_workflow && workflow.automation_sequence_yaml) {
      // Append to existing YAML
      const existingYaml = workflow.automation_sequence_yaml;

      // Simple append - in production, you'd want to properly parse and merge YAML
      if (existingYaml.includes('steps:')) {
        // Remove the 'steps:' line from new YAML since it already exists
        const stepsOnly = newStepsYaml.replace('steps:\n', '');
        updatedYaml = existingYaml + '\n' + stepsOnly;
      } else {
        updatedYaml = existingYaml + '\n\n' + newStepsYaml;
      }

      // Create JSON representation
      const existingSteps = workflow.automation_sequence?.steps || [];
      const newJsonSteps = steps.map(step => ({
        id: step.step_id || `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tool: step.tool_name,
        name: step.step_name || step.tool_name,
        arguments: step.arguments || {}
      }));
      updatedJson = {
        steps: [...existingSteps, ...newJsonSteps]
      };
    } else {
      // Replace with new steps only
      updatedYaml = newStepsYaml;
      updatedJson = {
        steps: steps.map(step => ({
          id: step.step_id || `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          tool: step.tool_name,
          name: step.step_name || step.tool_name,
          arguments: step.arguments || {}
        }))
      };
    }

    // Update the workflow - the database trigger will automatically:
    // 1. Create a new version in deployed_workflow_versions
    // 2. Increment the version number
    // 3. Update total_versions and current_version_id
    console.log('[ADD-TO-WORKFLOW] Updating workflow (trigger will handle versioning)...');

    const updatePayload = {
      automation_sequence: updatedJson,
      automation_sequence_yaml: updatedYaml,
      created_by: authenticatedUserId, // Needed for trigger's created_by field
      updated_at: new Date().toISOString()
    };

    const { data: updatedWorkflow, error: updateError } = await supabase
      .from('deployed_workflows')
      .update(updatePayload)
      .eq('id', workflow_id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating workflow:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update workflow' },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[ADD-TO-WORKFLOW] Workflow updated successfully:', {
      version: updatedWorkflow.version,
      total_versions: updatedWorkflow.total_versions,
      current_version_id: updatedWorkflow.current_version_id
    });

    // Mark steps as added to workflow
    const { error: markError } = await supabase
      .from('user_step_pool')
      .update({
        status: 'added_to_workflow',
        added_to_workflow_id: workflow_id,
        added_to_workflow_at: new Date().toISOString(),
        is_selected: false
      })
      .in('id', step_ids)
      .eq('user_id', authenticatedUserId);

    if (markError) {
      console.error('Error marking steps as added:', markError);
      // Non-critical error, continue
    }

    // If session_id provided, get remaining active steps count
    let remainingSteps = null;
    if (session_id) {
      const { count } = await supabase
        .from('user_step_pool')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', session_id)
        .eq('status', 'active')
        .eq('user_id', authenticatedUserId);

      remainingSteps = count;
    }

    return NextResponse.json({
      success: true,
      workflow: {
        id: updatedWorkflow.id,
        name: updatedWorkflow.name,
        version: updatedWorkflow.version,
        total_versions: updatedWorkflow.total_versions
      },
      steps_added: steps.length,
      remaining_pool_steps: remainingSteps
    }, { headers: corsHeaders });
  } catch (error) {
    console.error('Error in POST /api/step-pool/add-to-workflow:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}