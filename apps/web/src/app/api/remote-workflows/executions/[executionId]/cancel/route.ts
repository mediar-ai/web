import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to cancel execution');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { executionId: executionIdStr } = await params;
    const executionId = parseInt(executionIdStr);

    // Create Supabase client with service role key
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get the execution AND the workflow to check authorization
    const { data: execution, error: fetchError } = await supabase
      .from('workflow_executions')
      .select(`
        *,
        deployed_workflows!inner(
          id,
          name,
          created_by,
          organization_id
        )
      `)
      .eq('id', executionId)
      .single();

    if (fetchError || !execution) {
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const workflow = Array.isArray(execution.deployed_workflows)
      ? execution.deployed_workflows[0]
      : execution.deployed_workflows;
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', execution.workflow_id)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow canceling if:
    // - User is in Mediar org or is a Mediar admin (can cancel any execution)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized cancel for execution ${executionId} (workflow ${execution.workflow_id})`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to cancel this execution' },
        { status: 403 }
      );
    }

    // Only allow canceling if status is 'queued' or 'running'
    if (execution.status !== 'queued' && execution.status !== 'running') {
      return NextResponse.json(
        { error: `Cannot cancel execution with status: ${execution.status}` },
        { status: 400 }
      );
    }

    // Update the execution status to 'cancelled'
    const { data: updated, error: updateError } = await supabase
      .from('workflow_executions')
      .update({
        status: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('id', executionId)
      .select()
      .single();

    if (updateError) {
      console.error('Error canceling execution:', updateError);
      return NextResponse.json(
        { error: 'Failed to cancel execution' },
        { status: 500 }
      );
    }

    // Notify the appropriate executor to stop the running execution
    if (execution.status === 'running') {
      // Check if this is a Rust executor execution
      if (execution.executor_type === 'rust') {
        // Call Rust executor cancel endpoint
        const rustExecutorUrl = process.env.RUST_EXECUTOR_URL || 'https://workflow-executor-e4mtrji55a-ue.a.run.app';
        try {
          const cancelResponse = await fetch(`${rustExecutorUrl}/api/v1/executions/${executionId}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000) // 5 second timeout
          });

          if (cancelResponse.ok) {
            console.log(`[SUCCESS] Rust executor acknowledged cancellation for execution ${executionId}`);
          } else {
            // Log but don't fail - the DB update is the source of truth
            console.warn(`[WARN] Rust executor returned ${cancelResponse.status} for cancel request (execution may have completed)`);
          }
        } catch (rustError) {
          // Log but don't fail - the execution might be on a different instance
          console.warn(`[WARN] Could not reach Rust executor to cancel execution ${executionId}:`, rustError);
        }
      } else if (execution.modal_task_id) {
        // Modal executor - placeholder for future implementation
        console.log(`Would cancel Modal task: ${execution.modal_task_id}`);
      }
    }

    console.log(`[SUCCESS] User ${authenticatedUserId} cancelled execution ${executionId} (workflow ${execution.workflow_id})`);

    return NextResponse.json({
      success: true,
      execution: updated
    });

  } catch (error) {
    console.error('Error in cancel execution endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}