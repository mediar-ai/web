import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

// GET /api/remote-workflows/[workflowId]/github-yaml - Fetch YAML from GitHub
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to workflow YAML');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Get version from query params
    const { searchParams } = new URL(request.url);
    const versionNumber = searchParams.get('version');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    console.log(`📄 Fetching GitHub YAML for workflow ${workflowIdNum}${versionNumber ? ` version ${versionNumber}` : ''}`);

    // STEP 2: Get workflow info and verify authorization
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id, github_folder, github_path, github_ref, github_sha')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any workflow YAML)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized access to workflow ${workflowIdNum} YAML`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    // Check if workflow is GitHub-backed
    if (!workflow.github_path) {
      console.log(`⚠️ Workflow ${workflowIdNum} is not stored in GitHub`);

      // Fallback to database YAML for legacy workflows
      if (versionNumber) {
        // Get specific version from database
        const { data: versionData, error: versionError } = await supabase
          .from('deployed_workflow_versions')
          .select('automation_sequence_yaml')
          .eq('workflow_id', workflowIdNum)
          .eq('version_number', versionNumber)
          .single();

        if (versionError || !versionData) {
          return NextResponse.json(
            { success: false, error: `Version ${versionNumber} not found` },
            { status: 404 }
          );
        }

        return NextResponse.json({
          success: true,
          yaml: versionData.automation_sequence_yaml,
          source: 'database',
          version: versionNumber
        });
      } else {
        // Check if we should use latest version (for desktop) or active version (for web/production)
        const useLatest = versionNumber === 'latest';

        let versionQuery = supabase
          .from('deployed_workflow_versions')
          .select('automation_sequence_yaml, version_number')
          .eq('workflow_id', workflowIdNum);

        if (useLatest) {
          // Desktop app behavior - get the latest version by creation date
          versionQuery = versionQuery.order('created_at', { ascending: false }).limit(1);
        } else {
          // Web app/production behavior - get the active version
          versionQuery = versionQuery.eq('is_active', true);
        }

        const { data: selectedVersion, error: versionError } = await versionQuery.single();

        if (versionError || !selectedVersion) {
          const errorMessage = useLatest ? 'No versions found' : 'No active version found';
          return NextResponse.json(
            { success: false, error: errorMessage },
            { status: 404 }
          );
        }

        return NextResponse.json({
          success: true,
          yaml: selectedVersion.automation_sequence_yaml,
          source: 'database',
          version: selectedVersion.version_number
        });
      }
    }

    // For GitHub-backed workflows
    // If a specific version is requested, fetch from database (versions not stored as Git tags yet)
    if (versionNumber) {
      console.log(`📌 Fetching version ${versionNumber} from database`);

      const { data: versionData, error: versionError } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml')
        .eq('workflow_id', workflowIdNum)
        .eq('version_number', versionNumber)
        .single();

      if (versionError || !versionData?.automation_sequence_yaml) {
        return NextResponse.json(
          { success: false, error: `Version ${versionNumber} not found` },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        yaml: versionData.automation_sequence_yaml,
        source: 'database',
        version: versionNumber
      });
    }

    // For active version, fetch from GitHub
    try {
      const ref = workflow.github_ref || 'main';

      // Fetch the workflow YAML from GitHub
      const content = await githubWorkflowManager.getWorkflow(workflow.github_path, ref);

      if (!content) {
        throw new Error('Failed to fetch workflow from GitHub');
      }

      // Strip the metadata comment if present
      let cleanYaml = content.yaml;
      if (cleanYaml.startsWith('# Workflow:')) {
        const lines = cleanYaml.split('\n');
        const contentStart = lines.findIndex((line: string) => line === '# ---');
        if (contentStart !== -1) {
          cleanYaml = lines.slice(contentStart + 1).join('\n');
        }
      }

      return NextResponse.json({
        success: true,
        yaml: cleanYaml,
        source: 'github',
        github: {
          path: workflow.github_path,
          ref: ref,
          sha: content.metadata?.sha || workflow.github_sha
        },
        version: versionNumber || 'latest'
      });

    } catch (githubError) {
      console.error('❌ Failed to fetch from GitHub:', githubError);

      // Fallback to database if GitHub fetch fails
      const { data: fallbackVersion } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, version_number')
        .eq('workflow_id', workflowIdNum)
        .eq('is_active', true)
        .single();

      if (fallbackVersion?.automation_sequence_yaml) {
        return NextResponse.json({
          success: true,
          yaml: fallbackVersion.automation_sequence_yaml,
          source: 'database_fallback',
          version: fallbackVersion.version_number,
          warning: 'Failed to fetch from GitHub, using cached version'
        });
      }

      throw githubError;
    }

  } catch (error) {
    console.error('❌ Error fetching workflow YAML:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve workflow YAML',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}