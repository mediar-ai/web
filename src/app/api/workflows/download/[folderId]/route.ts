/**
 * API Route: GET /api/workflows/download/[folderId]
 *
 * Downloads all TypeScript workflow files for a workflow by github_folder (UUID).
 * Used by desktop app to pull cloud workflows that don't exist locally.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { WorkflowFileManager } from '@/lib/workflow-file-manager';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RouteContext {
  params: Promise<{
    folderId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // Check authentication
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId: effectiveOrgId } = await getEffectiveOrgId();

    if (!effectiveOrgId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { folderId } = await context.params;

    if (!folderId) {
      return NextResponse.json(
        { success: false, error: 'Missing folderId parameter' },
        { status: 400 }
      );
    }

    // Look up workflow by github_folder (UUID)
    const { data: workflow, error: lookupError } = await supabase
      .from('deployed_workflows')
      .select('id, name, description, organization_id, github_folder')
      .eq('github_folder', folderId)
      .single();

    if (lookupError || !workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (workflow.organization_id !== effectiveOrgId) {
      return NextResponse.json(
        { success: false, error: 'Not authorized' },
        { status: 403 }
      );
    }

    // Download files from storage
    const fileManager = new WorkflowFileManager();
    const result = await fileManager.downloadWorkflowFiles(workflow.id);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    // Get latest version info
    const { data: versionData } = await supabase
      .from('deployed_workflow_versions')
      .select('version_number')
      .eq('workflow_id', workflow.id)
      .eq('is_active', true)
      .single();

    return NextResponse.json({
      success: true,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        github_folder: workflow.github_folder,
        version: versionData?.version_number || '1.0.0',
      },
      files: result.files || [],
    });

  } catch (error) {
    console.error('Error downloading workflow:', error);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
