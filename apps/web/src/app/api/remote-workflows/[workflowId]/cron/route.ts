import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { resolveWorkflowId } from '@/lib/workflow-id-resolver';

/**
 * PATCH /api/remote-workflows/[workflowId]/cron - Toggle cron schedule
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to toggle cron schedule');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'enabled field must be a boolean' },
        { status: 400 }
      );
    }

    // Get environment variables and check them
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase environment variables are not set');
      return NextResponse.json(
        { success: false, error: 'Supabase configuration error' },
        { status: 500 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, created_by, organization_id, is_public, cron_auto_paused, auto_paused_at, auto_pause_reason, consecutive_failures'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    console.log(`🔄 ${enabled ? 'Enabling' : 'Disabling'} cron schedule for workflow ${workflowIdNum}`);

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // Prevent modification of public workflows (is_public = true) by non-Mediar users
    if (workflow.is_public && !isMediarOrg && !isMediarAdmin) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} attempted to toggle cron for public workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - Public workflows can only be modified by Mediar administrators' },
        { status: 403 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Modifying cron settings requires write or admin access level
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('access_level')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      // Only 'write' or 'admin' access levels can modify cron settings
      hasOrgAccess = !!orgAccess && ['write', 'admin'].includes(orgAccess.access_level);
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow's cron)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has write/admin access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized cron toggle for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    // Update the cron_enabled status
    const updateData: any = {
      cron_enabled: enabled,
      updated_at: new Date().toISOString()
    };

    // STEP 4: Handle auto-pause flag based on user action
    if (enabled) {
      // User is RE-ENABLING the schedule
      // Clear auto-pause flags to give workflow a fresh start
      if (workflow.cron_auto_paused) {
        console.log(`✅ User ${authenticatedUserId} re-enabling auto-paused workflow ${workflowIdNum} (${workflow.name})`);
        console.log(`   Previous auto-pause reason: ${workflow.auto_pause_reason}`);
        console.log(`   Clearing auto-pause flags to allow fresh start`);

        updateData.cron_auto_paused = false;
        updateData.consecutive_failures = 0;
        updateData.last_failure_message = null;
        updateData.auto_paused_at = null;
        updateData.auto_pause_reason = null;
      } else {
        console.log(`🔄 Enabling cron schedule for workflow ${workflowIdNum}`);
      }
    } else {
      // User is DISABLING the schedule
      // Also clear auto-pause flags to allow re-enabling later
      console.log(`🔄 Manually disabling cron and clearing auto-pause flag for workflow ${workflowIdNum}`);

      updateData.cron_auto_paused = false;
      updateData.consecutive_failures = 0;
      updateData.last_failure_message = null;
      updateData.auto_paused_at = null;
      updateData.auto_pause_reason = null;
    }

    const { data: updatedWorkflow, error } = await supabase
      .from('deployed_workflows')
      .update(updateData)
      .eq('id', workflowIdNum)
      .select('id, name, cron_expression, cron_enabled, cron_timezone')
      .single();

    if (error) {
      console.error('❌ Error updating cron schedule:', error);
      return NextResponse.json(
        { success: false, error: `Failed to update cron schedule: ${error.message}` },
        { status: 500 }
      );
    }

    if (!updatedWorkflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    console.log(`✅ Cron schedule ${enabled ? 'enabled' : 'disabled'} for workflow: ${updatedWorkflow.name}`);

    return NextResponse.json({
      success: true,
      workflow: updatedWorkflow,
      message: `Cron schedule ${enabled ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error) {
    console.error('❌ Cron toggle error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/remote-workflows/[workflowId]/cron - Update full cron configuration
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to update cron configuration');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const body = await request.json();
    const {
      cron_expression,
      cron_timezone,
      cron_enabled,
        cron_executor_type,
      cron_max_concurrent,
      cron_retry_on_failure,
      cron_retry_count,
      cron_default_inputs,
    } = body;

    // Validate required fields
    if (typeof cron_expression !== 'string' || !cron_expression.trim()) {
      return NextResponse.json(
        { success: false, error: 'cron_expression is required' },
        { status: 400 }
      );
    }

    if (typeof cron_timezone !== 'string' || !cron_timezone.trim()) {
      return NextResponse.json(
        { success: false, error: 'cron_timezone is required' },
        { status: 400 }
      );
    }

    // Get environment variables and check them
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase environment variables are not set');
      return NextResponse.json(
        { success: false, error: 'Supabase configuration error' },
        { status: 500 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, created_by, organization_id, is_public, cron_auto_paused, auto_paused_at, auto_pause_reason, consecutive_failures'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    console.log(`📝 Updating cron configuration for workflow ${workflowIdNum}`);

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg: isMediarOrgPut, isMediarAdmin: isMediarAdminPut } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Modifying cron settings requires write or admin access level
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('access_level')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      // Only 'write' or 'admin' access levels can modify cron settings
      hasOrgAccess = !!orgAccess && ['write', 'admin'].includes(orgAccess.access_level);
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow's cron)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has write/admin access via workflow_organization_access table
    if (!isMediarOrgPut && !isMediarAdminPut && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized cron update for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    // Update the cron configuration
    const updateData: Record<string, any> = {
      cron_expression,
      cron_timezone,
      cron_enabled: cron_enabled ?? false,
      updated_at: new Date().toISOString(),
    };

    // Add optional fields if provided
    if (cron_max_concurrent !== undefined) {
      updateData.cron_max_concurrent = cron_max_concurrent;
    }
    if (cron_retry_on_failure !== undefined) {
      updateData.cron_retry_on_failure = cron_retry_on_failure;
    }
    if (cron_retry_count !== undefined) {
      updateData.cron_retry_count = cron_retry_count;
    }
    if (cron_executor_type !== undefined) {
      updateData.cron_executor_type = cron_executor_type;
    }
    // Per-schedule input values passed to cron runs (see save-defaults vs. cron docs).
    // Must be a plain JSON object; reject arrays/primitives to avoid corrupting the column.
    if (cron_default_inputs !== undefined) {
      if (
        cron_default_inputs === null ||
        typeof cron_default_inputs !== 'object' ||
        Array.isArray(cron_default_inputs)
      ) {
        return NextResponse.json(
          { success: false, error: 'cron_default_inputs must be a JSON object' },
          { status: 400 }
        );
      }
      console.log(
        `[cron] Saving ${Object.keys(cron_default_inputs).length} default input(s) for scheduled runs`
      );
      updateData.cron_default_inputs = cron_default_inputs;
    }

    // STEP 4: Clear auto-pause flags when re-enabling (matching PATCH behavior)
    // This ensures that when users re-enable a schedule via the UI, any auto-pause state is cleared
    if (cron_enabled && workflow.cron_auto_paused) {
      console.log(`✅ User ${authenticatedUserId} re-enabling auto-paused workflow ${workflowIdNum} (${workflow.name})`);
      console.log(`   Previous auto-pause reason: ${workflow.auto_pause_reason}`);
      console.log(`   Clearing auto-pause flags to allow fresh start`);

      updateData.cron_auto_paused = false;
      updateData.consecutive_failures = 0;
      updateData.last_failure_message = null;
      updateData.auto_paused_at = null;
      updateData.auto_pause_reason = null;
    }

    const { data: updatedWorkflow, error } = await supabase
      .from('deployed_workflows')
      .update(updateData)
      .eq('id', workflowIdNum)
      .select('id, name, cron_expression, cron_enabled, cron_executor_type, cron_timezone, cron_max_concurrent, cron_retry_on_failure, cron_retry_count, cron_default_inputs')
      .single();

    if (error) {
      console.error('❌ Error updating cron configuration:', error);
      return NextResponse.json(
        { success: false, error: `Failed to update cron configuration: ${error.message}` },
        { status: 500 }
      );
    }

    if (!updatedWorkflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    console.log(`✅ Cron configuration updated for workflow: ${updatedWorkflow.name}`);

    return NextResponse.json({
      success: true,
      workflow: updatedWorkflow,
      message: 'Cron configuration updated successfully',
    });
  } catch (error) {
    console.error('❌ Cron update error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/remote-workflows/[workflowId]/cron - Get cron schedule info
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to read cron configuration');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Get environment variables and check them
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase environment variables are not set');
      return NextResponse.json(
        { success: false, error: 'Supabase configuration error' },
        { status: 500 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, created_by, organization_id, cron_expression, cron_timezone, cron_enabled, cron_executor_type, last_scheduled_execution, next_scheduled_execution, cron_max_concurrent, cron_retry_on_failure, cron_retry_count, cron_default_inputs'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || 'Workflow not found' },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg: isMediarOrgGet, isMediarAdmin: isMediarAdminGet } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow organization admins only for write operations
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
    // - User is in Mediar org or is a Mediar admin (can view any workflow's cron)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (org admins only)
    if (!isMediarOrgGet && !isMediarAdminGet && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of cron config for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      cron_config: workflow
    });

  } catch (error) {
    console.error('❌ Error fetching cron config:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
