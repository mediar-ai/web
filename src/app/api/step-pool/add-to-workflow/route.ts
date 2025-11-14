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
        { status: 401 }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.workflow_id || !body.step_ids || !Array.isArray(body.step_ids)) {
      return NextResponse.json(
        { success: false, error: 'workflow_id and step_ids array are required' },
        { status: 400 }
      );
    }

    const { workflow_id, step_ids, session_id, append_to_workflow = true } = body;

    // Fetch the selected steps
    const { data: steps, error: fetchError } = await supabase
      .from('user_step_pool')
      .select('*')
      .in('id', step_ids)
      .eq('user_id', authenticatedUserId)
      .eq('status', 'active')
      .order('pool_order', { ascending: true });

    if (fetchError || !steps || steps.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch pool steps' },
        { status: 404 }
      );
    }

    // Fetch the current workflow
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, automation_sequence_yaml, version_number, total_versions')
      .eq('id', workflow_id)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Convert steps to YAML
    const newStepsYaml = convertStepsToYaml(steps);

    let updatedYaml;
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
    } else {
      // Replace with new steps only
      updatedYaml = newStepsYaml;
    }

    // Update the workflow with new version
    // This would normally go through your workflow API endpoint
    const updatePayload = {
      automation_sequence_yaml: updatedYaml,
      version_number: incrementVersion(workflow.version_number || '1.0.0'),
      total_versions: (workflow.total_versions || 0) + 1
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
        { status: 500 }
      );
    }

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
        version_number: updatedWorkflow.version_number,
        total_versions: updatedWorkflow.total_versions
      },
      steps_added: steps.length,
      remaining_pool_steps: remainingSteps
    });
  } catch (error) {
    console.error('Error in POST /api/step-pool/add-to-workflow:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to increment semantic version
function incrementVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) return '1.0.1';

  const patch = parseInt(parts[2]) || 0;
  return `${parts[0]}.${parts[1]}.${patch + 1}`;
}