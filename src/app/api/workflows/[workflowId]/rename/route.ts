import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { githubWorkflowManager, getUserContext } from '@/lib/github-workflow-manager';
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
    // STEP 1: Authenticate
    const { auth } = await import('@clerk/nextjs/server');
    const { userId, orgId, has } = await auth();

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

    // STEP 2: Get workflow ownership and verify authorization
    const { data: workflowOwnership, error: ownershipError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id, is_public')
      .eq('id', workflowId)
      .single();

    if (ownershipError || !workflowOwnership) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // Prevent renaming of public workflows (is_public = true) by non-Mediar users
    if (workflowOwnership.is_public && !isMediarOrg && !isMediarAdmin) {
      console.warn(
        `[SECURITY] User ${userId} attempted to rename public workflow ${workflowId}`
      );
      return NextResponse.json(
        { error: 'Forbidden - Public workflows can only be renamed by Mediar administrators' },
        { status: 403 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflowOwnership.created_by === userId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflowOwnership.organization_id && workflowOwnership.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowId)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User is org admin AND organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${userId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized rename of workflow ${workflowId}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
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

        // Fetch user context for enhanced commit message
        const userContext = await getUserContext(userId, orgId);

        const githubResult = await githubWorkflowManager.saveWorkflow(
          name.trim(),
          yamlContent,
          isDevelopment,
          `Rename workflow: ${updatedWorkflow.name} → ${name.trim()}`,
          false, // Don't create PR - push directly
          workflowId,
          orgId || undefined,
          userContext
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