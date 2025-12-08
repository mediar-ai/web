import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

// POST /api/remote-workflows/[workflowId]/activate/[version] - Activate specific version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string; version: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to activate workflow version');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId, version } = await params;

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

    // STEP 2: Get workflow info and verify ownership
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, version, status, created_by, organization_id')
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
    // Activating versions requires write or admin access level
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('access_level')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      // Only 'write' or 'admin' access levels can activate versions
      hasOrgAccess = !!orgAccess && ['write', 'admin'].includes(orgAccess.access_level);
    }

    // DEBUG: Log authorization details
    console.log('[AUTH DEBUG] Authorization check:', {
      workflowId: workflowIdNum,
      workflowName: workflow.name,
      userId: authenticatedUserId,
      orgId,
      workflowCreatedBy: workflow.created_by,
      workflowOrgId: workflow.organization_id,
      isOwner,
      isOrgAdmin,
      isSameOrg,
      hasOrgAccess,
      isMediarOrg,
      isMediarAdmin,
      willAllow: isMediarOrg || isMediarAdmin || isOwner || (isOrgAdmin && isSameOrg) || hasOrgAccess
    });

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has write/admin access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized version activation for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        {
          error: 'Forbidden - You do not have permission to modify this workflow',
          debug: {
            isOwner,
            isOrgAdmin,
            isSameOrg,
            hasOrgAccess,
            isMediarOrg,
            isMediarAdmin,
            workflowCreatedBy: workflow.created_by,
            workflowOrgId: workflow.organization_id,
            yourUserId: authenticatedUserId,
            yourOrgId: orgId
          }
        },
        { status: 403 }
      );
    }

    // Check if target version exists
    const { data: targetVersion, error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .select('id, version_number, is_active, automation_sequence, change_notes')
      .eq('workflow_id', workflowIdNum)
      .eq('version_number', version)
      .single();

    if (versionError || !targetVersion) {
      return NextResponse.json(
        { success: false, error: `Version ${version} not found for workflow ${workflowIdNum}` },
        { status: 404 }
      );
    }

    // Check if already active
    if (targetVersion.is_active) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Version ${version} is already active`,
          current_version: version
        },
        { status: 400 }
      );
    }

    // Activate the target version using the database function
    const { error: activateError } = await supabase
      .rpc('activate_workflow_version', {
        p_workflow_id: workflowIdNum,
        p_version_number: version
      });

    if (activateError) {
      throw new Error(`Failed to activate version: ${activateError.message}`);
    }

    // Get updated workflow info
    const { data: updatedWorkflow } = await supabase
      .from('deployed_workflows')
      .select('version, current_version_id, updated_at')
      .eq('id', workflowIdNum)
      .single();

    const response = {
      success: true,
      message: `Successfully activated version ${version} for workflow "${workflow.name}"`,
             activation: {
         workflow_id: workflowIdNum,
         workflow_name: workflow.name,
         previous_version: workflow.version,
         activated_version: version,
         activated_at: new Date().toISOString(),
         change_notes: targetVersion.change_notes
       },
      workflow_status: {
        id: workflowIdNum,
        current_version: updatedWorkflow?.version || version,
        current_version_id: updatedWorkflow?.current_version_id,
        status: workflow.status,
        last_updated: updatedWorkflow?.updated_at
      },
      impact: {
        description: 'All new executions will now use this version',
        automation_sequence_updated: true,
        existing_executions_unaffected: true
      }
    };

    console.log(`[SUCCESS] Activated version ${version} for workflow ${workflowIdNum} (${workflow.name})`);

    return NextResponse.json(response);

  } catch (error) {
    console.error('[ERROR] Error activating workflow version:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to activate workflow version',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 