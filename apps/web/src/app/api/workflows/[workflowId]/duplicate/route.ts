import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
import * as yaml from 'js-yaml';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/workflows/[workflowId]/duplicate - Duplicate an existing workflow
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate (support both desktop tokens and Clerk web auth)
    const { getEffectiveOrgId, isWorkflowOwner } = await import('@/lib/mediarAuth');
    const authResult = await getEffectiveOrgId(null);
    const userId = authResult.userId;
    const orgId = authResult.orgId;
    const isMediarOrg = authResult.isMediarOrg;
    const isMediarAdmin = authResult.isMediarAdmin;
    const authEmail = authResult.email; // Email from desktop token or Clerk

    // Still need Clerk's has() function for role checks and get email
    const { auth } = await import('@clerk/nextjs/server');
    const { has, sessionClaims } = await auth();
    const userEmail = authEmail || sessionClaims?.email as string || null;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId: workflowIdStr } = await params;

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowId, error: resolveError } = await getNumericWorkflowId(supabase, workflowIdStr);
    if (resolveError || workflowId === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowIdStr} not found` },
        { status: 404 }
      );
    }

    // Get version from query params (desktop app sends version=latest)
    const { searchParams } = new URL(request.url);
    const versionParam = searchParams.get('version');
    const useLatest = versionParam === 'latest';

    // Optional: accept custom name and description in request body
    const body = await request.json().catch(() => ({}));
    const customName = body.name;
    const customDescription = body.description;

    console.log(`🔄 Duplicating workflow ID: ${workflowId}${useLatest ? ' (using latest version)' : ''}`);

    // Fetch the original workflow
    const { data: originalWorkflow, error: fetchError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();

    if (fetchError || !originalWorkflow) {
      console.error('❌ Error fetching original workflow:', fetchError);
      return NextResponse.json(
        {
          success: false,
          error: `Workflow not found: ${fetchError?.message || 'Unknown error'}`,
        },
        { status: 404 }
      );
    }

    // STEP 2: AUTHORIZATION - Verify user has READ access to source workflow before duplicating
    // (authResult values already extracted above)

    const isOwner = isWorkflowOwner(originalWorkflow.created_by, userId, userEmail);
    // For desktop tokens, has() may not be available - only check for web Clerk sessions
    const isOrgAdmin = (has && typeof has === 'function')
      ? (has({ role: 'org:admin' }) || has({ role: 'org:owner' }))
      : false;
    const isSameOrg = originalWorkflow.organization_id && originalWorkflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowId)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow duplication if:
    // - User is in Mediar org or is a Mediar admin (can duplicate any workflow)
    // - User is the workflow owner
    // - User is org admin/member in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${userId} (orgId: ${orgId}) attempted unauthorized duplication of workflow ${workflowId}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    // Fetch the source version of the original workflow
    // Desktop app (version=latest): get latest version by created_at
    // Web app: get active version (is_active=true)
    let versionQuery = supabase
      .from('deployed_workflow_versions')
      .select('*')
      .eq('workflow_id', workflowId);

    if (useLatest) {
      // Desktop app behavior - get the latest version by creation date
      versionQuery = versionQuery.order('created_at', { ascending: false }).limit(1);
    } else {
      // Web app/production behavior - get the active version
      versionQuery = versionQuery.eq('is_active', true);
    }

    const { data: sourceVersion, error: versionError } = await versionQuery.single();

    if (versionError || !sourceVersion) {
      const errorMessage = useLatest ? 'No versions found' : 'Active version not found';
      console.error(`❌ Error fetching source version: ${errorMessage}`, versionError);
      return NextResponse.json(
        {
          success: false,
          error: `${errorMessage}: ${versionError?.message || 'Unknown error'}`,
        },
        { status: 404 }
      );
    }

    console.log(`📋 Source version: ${sourceVersion.version_number} (${useLatest ? 'latest' : 'active'})`);

    // Use custom name if provided, otherwise generate with (Copy) suffix
    // If name already exists, increment with (2), (3), etc.
    const baseName = customName?.trim() || `${originalWorkflow.name} (Copy)`;
    let duplicateName = baseName;
    let counter = 1;

    // Find a unique name by incrementing if needed
    while (true) {
      const { data: existing } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('name', duplicateName)
        .single();

      if (!existing) break;

      counter++;
      duplicateName = `${baseName} (${counter})`;
    }

    // Create the duplicate workflow
    const duplicateWorkflowData = {
      name: duplicateName,
      description: customDescription || `${originalWorkflow.description || ''} (Duplicated from ${originalWorkflow.name})`,
      version: '1.0.0',
      status: 'deployed',
      workflow_type: originalWorkflow.workflow_type || 'execution',
      parent_workflow_id: originalWorkflow.parent_workflow_id,
      automation_sequence: sourceVersion.automation_sequence,
      estimated_duration_seconds: originalWorkflow.estimated_duration_seconds,
      // Preserve cron settings but disable by default for safety
      // If there's no cron expression, don't set cron fields
      cron_expression: originalWorkflow.cron_expression || null,
      cron_timezone: originalWorkflow.cron_expression ? (originalWorkflow.cron_timezone || 'UTC') : null,
      cron_enabled: false, // Always disable cron for duplicates for safety
      cron_max_concurrent: originalWorkflow.cron_expression ? (originalWorkflow.cron_max_concurrent || 1) : null,
      cron_retry_on_failure: originalWorkflow.cron_expression ? (originalWorkflow.cron_retry_on_failure !== false) : null,
      cron_retry_count: originalWorkflow.cron_expression ? (originalWorkflow.cron_retry_count || 3) : null,
      // Organization ownership - duplicate belongs to current user's organization
      organization_id: orgId || null,
      // Metadata
      created_by: userId || null, // Store Clerk user ID for ownership checks
      total_versions: 1,
    };

    // Insert duplicate workflow
    const { data: newWorkflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .insert(duplicateWorkflowData)
      .select()
      .single();

    if (workflowError) {
      console.error('❌ Error creating duplicate workflow:', workflowError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to duplicate workflow: ${workflowError.message}`,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created duplicate workflow with ID: ${newWorkflow.id}`);

    // Grant current organization admin access to the duplicate workflow
    if (orgId) {
      const { error: accessError } = await supabase
        .from('workflow_organization_access')
        .insert({
          workflow_id: newWorkflow.id,
          organization_id: orgId,
          access_level: 'admin',
          granted_at: new Date().toISOString(),
          workflow_uuid: newWorkflow.uuid, // Required for check_org_workflow_access function
        });

      if (accessError) {
        console.error('⚠️ Failed to grant organization access to duplicate:', accessError);
        // Don't fail the whole duplication, but log the issue
      } else {
        console.log(`✅ Granted ${orgId} admin access to duplicate workflow ${newWorkflow.id}`);
      }
    }

    // Create the initial version for the duplicate
    const duplicateVersionData = {
      workflow_id: newWorkflow.id,
      version_number: '1.0.0',
      automation_sequence_yaml: sourceVersion.automation_sequence_yaml,
      automation_sequence: sourceVersion.automation_sequence,
      preferred_format: sourceVersion.preferred_format || 'yaml',
      is_active: true,
      change_notes: `Duplicated from workflow "${originalWorkflow.name}" (ID: ${workflowId})`,
    };

    const { data: newVersion, error: versionError2 } = await supabase
      .from('deployed_workflow_versions')
      .insert(duplicateVersionData)
      .select()
      .single();

    if (versionError2) {
      console.error('❌ Error creating duplicate version:', versionError2);
      // Try to clean up the workflow if version creation failed
      await supabase
        .from('deployed_workflows')
        .delete()
        .eq('id', newWorkflow.id);

      return NextResponse.json(
        {
          success: false,
          error: `Failed to create duplicate workflow version: ${versionError2.message}`,
        },
        { status: 500 }
      );
    }

    console.log(`✅ Created duplicate version: ${newVersion.version_number}`);

    // Push duplicated workflow to GitHub (fire-and-forget)
    const yamlContent = newVersion.automation_sequence_yaml ||
                       yaml.dump(newVersion.automation_sequence);
    const isDevelopment = newWorkflow.status === 'draft' ||
                         newWorkflow.workflow_type === 'settings';

    githubWorkflowManager.saveWorkflow(
      duplicateName,
      yamlContent,
      isDevelopment,
      `Duplicate workflow from "${originalWorkflow.name}" (ID: ${workflowId})`,
      false,
      newWorkflow.id,
      orgId || undefined,
      { email: userEmail || undefined }
    ).then(async (result) => {
      if (result.success) {
        console.log(`✅ Pushed duplicated workflow to GitHub: ${result.path}`);
        await supabase
          .from('github_workflow_sync_log')
          .insert({
            workflow_id: newWorkflow.id,
            operation: 'duplicate',
            github_path: result.path,
            github_sha: result.sha,
            status: 'success'
          });
      } else {
        console.warn(`⚠️ GitHub push failed: ${result.error}`);
      }
    }).catch((error) => {
      console.error('GitHub sync error during duplication:', error);
    });

    // If the original workflow has settings workflows, we can optionally duplicate those too
    // For now, we'll skip this to keep it simple

    // Return the complete duplicate workflow data
    const response = {
      success: true,
      workflow: {
        ...newWorkflow,
        version_info: newVersion,
      },
      message: `Successfully duplicated workflow as "${duplicateName}"`,
      original_workflow_id: workflowId,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error('❌ Workflow duplication error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}