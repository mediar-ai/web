import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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
    const workflowIdNum = parseInt(workflowId);

    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'enabled field must be a boolean' },
        { status: 400 }
      );
    }

    console.log(`🔄 ${enabled ? 'Enabling' : 'Disabling'} cron schedule for workflow ${workflowIdNum}`);

    // Get environment variables and check them
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase environment variables are not set');
      return NextResponse.json(
        { success: false, error: 'Supabase configuration error' },
        { status: 500 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow info and verify ownership (including auto-pause status)
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id, cron_auto_paused, auto_paused_at, auto_pause_reason, consecutive_failures')
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
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow's cron)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized cron toggle for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    // STEP 4: Check if workflow is auto-paused
    if (enabled && workflow.cron_auto_paused) {
      console.warn(
        `⚠️  User ${authenticatedUserId} attempted to enable auto-paused workflow ${workflowIdNum} (${workflow.name})`
      );
      console.warn(`   Auto-paused at: ${workflow.auto_paused_at}`);
      console.warn(`   Reason: ${workflow.auto_pause_reason}`);
      console.warn(`   Consecutive failures: ${workflow.consecutive_failures}`);

      return NextResponse.json(
        {
          success: false,
          error: 'Cannot enable cron schedule - workflow is auto-paused due to repeated failures',
          details: {
            auto_paused: true,
            auto_paused_at: workflow.auto_paused_at,
            auto_pause_reason: workflow.auto_pause_reason,
            consecutive_failures: workflow.consecutive_failures,
            message: 'Please fix the underlying issue first, then clear the auto-pause flag before re-enabling the cron schedule.'
          }
        },
        { status: 400 }
      );
    }

    // Update the cron_enabled status
    const updateData: any = {
      cron_enabled: enabled,
      updated_at: new Date().toISOString()
    };

    // If disabling manually, clear auto-pause flag to allow re-enabling later
    if (!enabled) {
      updateData.cron_auto_paused = false;
      updateData.consecutive_failures = 0;
      updateData.last_failure_message = null;
      updateData.auto_paused_at = null;
      updateData.auto_pause_reason = null;
      console.log(`🔄 Manually disabling cron and clearing auto-pause flag for workflow ${workflowIdNum}`);
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
    const workflowIdNum = parseInt(workflowId);

    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      cron_expression,
      cron_timezone,
      cron_enabled,
      cron_max_concurrent,
      cron_retry_on_failure,
      cron_retry_count,
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

    console.log(`📝 Updating cron configuration for workflow ${workflowIdNum}`);

    // Get environment variables and check them
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase environment variables are not set');
      return NextResponse.json(
        { success: false, error: 'Supabase configuration error' },
        { status: 500 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow info and verify ownership
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id')
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
    const { isMediarOrg: isMediarOrgPut, isMediarAdmin: isMediarAdminPut } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow's cron)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
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

    const { data: updatedWorkflow, error } = await supabase
      .from('deployed_workflows')
      .update(updateData)
      .eq('id', workflowIdNum)
      .select('id, name, cron_expression, cron_enabled, cron_timezone, cron_max_concurrent, cron_retry_on_failure, cron_retry_count')
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
    const workflowIdNum = parseInt(workflowId);

    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    // Get environment variables and check them
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('❌ Supabase environment variables are not set');
      return NextResponse.json(
        { success: false, error: 'Supabase configuration error' },
        { status: 500 }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow info and verify ownership
    const { data: workflow, error } = await supabase
      .from('deployed_workflows')
      .select(`
        id,
        name,
        created_by,
        organization_id,
        cron_expression,
        cron_timezone,
        cron_enabled,
        last_scheduled_execution,
        next_scheduled_execution,
        cron_max_concurrent,
        cron_retry_on_failure,
        cron_retry_count
      `)
      .eq('id', workflowIdNum)
      .single();

    if (error || !workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg: isMediarOrgGet, isMediarAdmin: isMediarAdminGet } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
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
    // - User's organization has access via workflow_organization_access table
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
