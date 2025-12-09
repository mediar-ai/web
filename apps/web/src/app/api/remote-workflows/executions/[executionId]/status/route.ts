import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  // Redirect to unified endpoint
  const { executionId } = await params;
  return NextResponse.redirect(new URL(`/api/remote-workflows/executions/${executionId}`, request.url));
}

// Cancel execution endpoint (LEGACY - use /cancel endpoint instead)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to cancel execution (legacy endpoint)');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase environment variables are not set.' }, { status: 500 });
    }

    const { executionId } = await params;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // STEP 2: Get execution WITH workflow info for authorization check
    const { data: execution, error: fetchError } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        status,
        modal_call_id,
        workflow_id,
        deployed_workflows!inner(
          id,
          name,
          created_by,
          organization_id
        )
      `)
      .eq('id', executionId)
      .single();

    if (fetchError) throw fetchError;
    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
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
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized cancellation of execution ${executionId}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this execution' },
        { status: 403 }
      );
    }

    if (!['queued', 'running'].includes(execution.status)) {
      return NextResponse.json({ 
        error: 'Execution cannot be cancelled', 
        current_status: execution.status 
      }, { status: 400 });
    }

    // Update status to cancelled
    const { error: updateError } = await supabase
      .from('workflow_executions')
      .update({ 
        status: 'cancelled',
        completed_at: new Date().toISOString(),
        error_message: 'Cancelled by client request'
      })
      .eq('id', executionId);

    if (updateError) throw updateError;

    // TODO: Cancel Modal execution if running
    // await cancelModalExecution(execution.modal_call_id);

    return NextResponse.json({ 
      message: 'Execution cancelled successfully',
      execution_id: execution.id,
      status: 'cancelled'
    });

  } catch (error) {
    console.error('Error cancelling execution:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Internal server error', details: errorMessage }, { status: 500 });
  }
}
