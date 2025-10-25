import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
import * as yaml from 'js-yaml';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * PATCH /api/workflows/[workflowId]/rename - Rename a workflow
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // Check authentication
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId: workflowIdStr } = await params;
    const workflowId = parseInt(workflowIdStr);
    if (isNaN(workflowId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, description } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Name is required' },
        { status: 400 }
      );
    }

    // Check if a workflow with this name already exists
    const { data: existing } = await supabase
      .from('deployed_workflows')
      .select('id')
      .eq('name', name.trim())
      .neq('id', workflowId)
      .single();

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'A workflow with this name already exists' },
        { status: 400 }
      );
    }

    // Update the workflow
    const updateData: any = { name: name.trim() };
    if (description !== undefined) {
      updateData.description = description;
    }

    const { data: updatedWorkflow, error: updateError } = await supabase
      .from('deployed_workflows')
      .update(updateData)
      .eq('id', workflowId)
      .select()
      .single();

    if (updateError) {
      console.error('Error renaming workflow:', updateError);
      return NextResponse.json(
        { success: false, error: `Failed to rename workflow: ${updateError.message}` },
        { status: 500 }
      );
    }

    // Push updated workflow to GitHub
    try {
      // Get the active version to get YAML content
      const { data: activeVersion } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence')
        .eq('workflow_id', workflowId)
        .eq('is_active', true)
        .single();

      if (activeVersion) {
        const yamlContent = activeVersion.automation_sequence_yaml ||
                           yaml.dump(activeVersion.automation_sequence);

        const isDevelopment = updatedWorkflow.status === 'draft' ||
                             updatedWorkflow.workflow_type === 'settings';

        const githubResult = await githubWorkflowManager.saveWorkflow(
          name.trim(),
          yamlContent,
          isDevelopment,
          `Rename workflow: ${updatedWorkflow.name} → ${name.trim()}`,
          false, // Don't create PR - push directly
          workflowId
        );

        if (githubResult.success) {
          console.log(`✅ Pushed renamed workflow to GitHub: ${githubResult.path}`);

          // Log sync operation
          await supabase
            .from('github_workflow_sync_log')
            .insert({
              workflow_id: workflowId,
              operation: 'rename',
              github_path: githubResult.path,
              github_sha: githubResult.sha,
              status: 'success'
            });
        } else {
          console.warn(`⚠️ GitHub push failed: ${githubResult.error}`);
          // Continue anyway - GitHub is optional enhancement
        }
      }
    } catch (githubError) {
      console.error('GitHub sync error during rename:', githubError);
      // Don't fail the whole operation - GitHub is supplementary
    }

    return NextResponse.json({
      success: true,
      workflow: updatedWorkflow,
      message: `Workflow renamed to "${name.trim()}"`,
    });
  } catch (error) {
    console.error('Error in rename workflow:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}