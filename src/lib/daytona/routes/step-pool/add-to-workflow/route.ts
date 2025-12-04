import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import * as yaml from 'js-yaml';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    const { workflow_id, step_ids, session_id, append_to_workflow = true, insert_at_index } = body;

    console.log('[ADD-TO-WORKFLOW] Request:', { workflow_id, step_ids, session_id, insert_at_index, user_id: authenticatedUserId });

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

    // Load the LATEST workflow version using workflowLoader
    // This ensures we're appending to the most recent edits, not stale data from deployed_workflows
    const { workflowLoader } = await import('@/lib/workflow-loader');
    const loadedWorkflow = await workflowLoader.loadWorkflow(workflow_id);

    console.log('[ADD-TO-WORKFLOW] Loaded latest workflow:', {
      workflow_id,
      found: !!loadedWorkflow,
      version: loadedWorkflow?.metadata?.version,
      source: loadedWorkflow?.metadata?.source
    });

    if (!loadedWorkflow) {
      console.error('[ADD-TO-WORKFLOW] Workflow not found:', { workflow_id });
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404, headers: corsHeaders }
      );
    }

    // Convert pool steps to workflow step format
    const newSteps = steps.map(step => {
      // Normalize arguments: disable expensive UI diff params for production workflows
      const normalizedArgs = { ...(step.arguments || {}) };
      if ('ui_diff_before_after' in normalizedArgs) {
        normalizedArgs.ui_diff_before_after = false;
      }
      if ('include_tree_after_action' in normalizedArgs) {
        normalizedArgs.include_tree_after_action = false;
      }

      return {
        id: step.step_id || `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tool_name: step.tool_name,
        name: step.step_name || step.tool_name,
        arguments: normalizedArgs
      };
    });

    let updatedJson;
    const workflow = loadedWorkflow.automation_sequence || {};

    if (insert_at_index !== undefined && insert_at_index !== null) {
      // Insert at specific position (for drag-and-drop)
      const existingSteps = [...(workflow.steps || [])];
      // Clamp index to valid range
      const insertIndex = Math.max(0, Math.min(insert_at_index, existingSteps.length));
      existingSteps.splice(insertIndex, 0, ...newSteps);
      updatedJson = {
        ...workflow,
        steps: existingSteps
      };
      console.log('[ADD-TO-WORKFLOW] Inserted steps at index:', insertIndex, 'total steps:', existingSteps.length);
    } else if (append_to_workflow) {
      // Append new steps to existing steps from LATEST version
      // FIXED: Preserve all properties (variables, selectors, stop_on_error, etc.)
      updatedJson = {
        ...workflow,
        steps: [...(workflow.steps || []), ...newSteps]
      };
    } else {
      // Replace with new steps only
      // FIXED: Preserve all properties except steps
      updatedJson = {
        ...workflow,
        steps: newSteps
      };
    }

    // Generate YAML from the updated JSON
    const updatedYaml = yaml.dump(updatedJson, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });

    // Update the workflow - the database trigger will automatically:
    // 1. Create a new version in deployed_workflow_versions
    // 2. Increment the version number
    // 3. Update total_versions and current_version_id
    console.log('[ADD-TO-WORKFLOW] Updating workflow (trigger will handle versioning)...');

    const updatePayload = {
      automation_sequence: updatedJson,
      automation_sequence_yaml: updatedYaml,
      updated_at: new Date().toISOString()
    };

    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update(updatePayload)
      .eq('id', workflow_id);

    if (updateError) {
      console.error('Error updating workflow:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update workflow' },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[ADD-TO-WORKFLOW] Workflow updated successfully, reloading from latest version...');

    // Reload the workflow to get the new version (after trigger created it)
    const reloadedWorkflow = await workflowLoader.loadWorkflow(workflow_id);

    if (!reloadedWorkflow) {
      console.error('[ADD-TO-WORKFLOW] Failed to reload workflow after update');
      return NextResponse.json(
        { success: false, error: 'Failed to reload workflow after update' },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[ADD-TO-WORKFLOW] Workflow reloaded successfully:', {
      source: reloadedWorkflow.metadata.source,
      version: reloadedWorkflow.metadata.version
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

    // Fetch version metadata from deployed_workflows for response
    const { data: workflowMetadata } = await supabase
      .from('deployed_workflows')
      .select('version, total_versions, current_version_id')
      .eq('id', workflow_id)
      .single();

    // Generate proper YAML from the reloaded automation_sequence
    // This ensures the desktop app gets valid, parseable YAML
    const regeneratedYaml = yaml.dump(reloadedWorkflow.automation_sequence, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });

    return NextResponse.json({
      success: true,
      workflow: {
        id: reloadedWorkflow.id,
        name: reloadedWorkflow.name,
        version: workflowMetadata?.version,
        total_versions: workflowMetadata?.total_versions,
        automation_sequence: reloadedWorkflow.automation_sequence,
        automation_sequence_yaml: regeneratedYaml, // Properly generated YAML
        current_version_id: workflowMetadata?.current_version_id,
        metadata: reloadedWorkflow.metadata
      },
      steps_added: steps.length,
      inserted_at_index: insert_at_index !== undefined ? Math.max(0, Math.min(insert_at_index, (workflow.steps || []).length)) : null,
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