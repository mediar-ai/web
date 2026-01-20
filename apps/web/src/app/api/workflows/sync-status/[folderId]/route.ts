/**
 * API Route: GET /api/workflows/sync-status/[folderId]
 *
 * Returns the content_updated_at timestamp for a workflow by its github_folder (UUID).
 * Used by desktop app to check if remote CONTENT has changed since last sync.
 *
 * Note: Returns content_updated_at as "updated_at" for backward compatibility.
 * This field only changes when workflow content changes, NOT for metadata changes
 * like visibility, cron settings, etc.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{
    folderId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const supabase = getSupabaseAdmin();
  try {
    // Check authentication
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId: effectiveOrgId } = await getEffectiveOrgId();

    if (!effectiveOrgId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { folderId } = await context.params;

    if (!folderId) {
      return NextResponse.json(
        { error: 'Missing folderId parameter' },
        { status: 400 }
      );
    }

    // Look up workflow by github_folder (UUID)
    const { data: workflow, error } = await supabase
      .from('deployed_workflows')
      .select('id, content_updated_at, organization_id, uuid')
      .eq('github_folder', folderId)
      .single();

    if (error || !workflow) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Verify write access using centralized permission check (consistent with publish-typescript)
    const { checkWorkflowAccess } = await import('@/lib/workflow-permissions');
    const access = await checkWorkflowAccess(effectiveOrgId, workflow.uuid);

    console.log(`[sync-status] folderId=${folderId} workflowOrg=${workflow.organization_id} userOrg=${effectiveOrgId} accessLevel=${access.accessLevel} canWrite=${access.canWrite}`);

    if (!access.canWrite) {
      return NextResponse.json(
        { error: 'Not authorized' },
        { status: 403 }
      );
    }

    // Get latest version from versions table
    const { data: latestVersion } = await supabase
      .from('deployed_workflow_versions')
      .select('version_number')
      .eq('workflow_id', workflow.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      updated_at: workflow.content_updated_at,
      workflow_id: workflow.id,
      latest_version: latestVersion?.version_number || null,
    });

  } catch (error) {
    console.error('Error checking sync status:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
