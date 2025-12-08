import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkflowId } from '@/lib/workflow-id-resolver';

/**
 * DELETE /api/remote-workflows/[workflowId]/versions/latest
 *
 * Deletes the latest workflow version (by created_at DESC).
 * Desktop app always loads latest version, so this provides a rollback mechanism.
 *
 * Authorization: Requires admin-level access (same as DELETE workflow)
 * Safety checks:
 * - Cannot delete if executions reference this version
 * - Cannot delete if it's the current_version_id
 * - Cannot delete if it's the only version
 * - Cannot delete public workflow versions as non-Mediar user
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: AUTHENTICATION - Support both desktop token and Clerk auth
    let authenticatedUserId: string | null = null;
    let orgId: string | null = null;
    let has: (params: { role: string }) => boolean = () => false;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import('@/lib/auth/validateDesktopToken');
      const validation = await validateDesktopToken(token);

      if (validation.valid && validation.userId) {
        authenticatedUserId = validation.userId;
        orgId = validation.orgId ?? null;
        has = () => false; // Desktop auth doesn't support Clerk role checks
        console.log(`🔐 Desktop token validated for user ${authenticatedUserId} (orgId: ${orgId})`);
      }
    }

    // Fall back to Clerk auth if desktop token not found/valid
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
      orgId = clerkAuth.orgId ?? null;
      has = clerkAuth.has;
    }

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to DELETE /versions/latest');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(supabase, workflowId);

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    // STEP 3: AUTHORIZATION - Require admin-level access (same as DELETE workflow)
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for admin access
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('access_level')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      // DELETE requires 'admin' access level (write cannot delete)
      hasOrgAccess = !!orgAccess && orgAccess.access_level === 'admin';
    }

    // Prevent deletion of public workflow versions by non-Mediar users
    if (workflow.is_public && !isMediarOrg && !isMediarAdmin) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} attempted to delete public workflow version ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - Cannot delete versions of public workflows' },
        { status: 403 }
      );
    }

    // Allow deletion if:
    // - User is in Mediar org or is a Mediar admin (can delete any workflow version)
    // - User is the workflow owner
    // - User is in the same org (organization_id field) - supports desktop users
    // - User's organization has admin access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !isSameOrg && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isSameOrg: ${isSameOrg}) attempted unauthorized deletion of version from workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to delete workflow versions' },
        { status: 403 }
      );
    }

    console.log(`🔐 Authorization check passed - User ${authenticatedUserId} can delete versions from workflow ${workflowIdNum}`);

    // STEP 4: SAFETY CHECKS - Get latest version
    const { data: versions, error: versionsError } = await supabase
      .from('deployed_workflow_versions')
      .select('id, version_number, is_active, created_at')
      .eq('workflow_id', workflowIdNum)
      .order('created_at', { ascending: false });

    if (versionsError || !versions || versions.length === 0) {
      return NextResponse.json(
        { error: 'No versions found for this workflow' },
        { status: 404 }
      );
    }

    const latestVersion = versions[0];

    // Safety check 1: Must have at least 2 versions (cannot delete the only version)
    if (versions.length < 2) {
      return NextResponse.json(
        { error: 'Cannot delete the only version of a workflow', reason: 'ONLY_VERSION' },
        { status: 409 }
      );
    }

    // Safety check 2: Cannot delete if it's the current_version_id
    if (workflow.current_version_id === latestVersion.id) {
      return NextResponse.json(
        {
          error: 'Cannot delete version: it is the current deployed version',
          reason: 'IS_CURRENT_VERSION',
          suggestion: 'Activate a different version first, then delete this one'
        },
        { status: 409 }
      );
    }

    // Safety check 3: Cannot delete if executions reference this version
    const { data: executions, error: executionsError } = await supabase
      .from('workflow_executions')
      .select('id')
      .eq('workflow_version_id', latestVersion.id)
      .limit(1);

    if (executionsError) {
      console.error('Error checking executions:', executionsError);
      return NextResponse.json(
        { error: 'Failed to verify version safety' },
        { status: 500 }
      );
    }

    if (executions && executions.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete version: executions reference this version',
          reason: 'HAS_EXECUTIONS',
          suggestion: 'This version has execution history and cannot be deleted'
        },
        { status: 409 }
      );
    }

    // STEP 5: DELETE the latest version
    console.log(`🗑️ User ${authenticatedUserId} deleting latest version (${latestVersion.version_number}, ID: ${latestVersion.id}) from workflow ${workflowIdNum}`);

    const { error: deleteError } = await supabase
      .from('deployed_workflow_versions')
      .delete()
      .eq('id', latestVersion.id);

    if (deleteError) {
      console.error('Error deleting version:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete version', details: deleteError.message },
        { status: 500 }
      );
    }

    // STEP 6: Update workflow's total_versions count
    const currentTotalVersions = (workflow.total_versions as number) || 0;
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        total_versions: Math.max(0, currentTotalVersions - 1),
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowIdNum);

    if (updateError) {
      console.warn('Failed to update total_versions:', updateError);
      // Non-critical error, continue
    }

    // Get new latest version info
    const newLatestVersion = versions[1]; // Second version becomes latest

    console.log(`✅ Successfully deleted version ${latestVersion.version_number}. New latest: ${newLatestVersion.version_number}`);

    return NextResponse.json({
      success: true,
      message: 'Latest version deleted successfully',
      deleted_version: {
        id: latestVersion.id,
        version_number: latestVersion.version_number
      },
      new_latest_version: {
        id: newLatestVersion.id,
        version_number: newLatestVersion.version_number,
        created_at: newLatestVersion.created_at
      }
    });

  } catch (error) {
    console.error('Error in DELETE /versions/latest:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
