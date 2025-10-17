import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to delete execution');
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
        id,
        workflow_id,
        status,
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

    // Allow deletion if:
    // - User is in Mediar org or is a Mediar admin (can delete any execution)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized delete for execution ${executionId} (workflow ${execution.workflow_id})`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to delete this execution' },
        { status: 403 }
      );
    }

    // Delete the execution
    const { error: deleteError } = await supabase
      .from('workflow_executions')
      .delete()
      .eq('id', executionId);

    if (deleteError) {
      console.error('Error deleting execution:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete execution' },
        { status: 500 }
      );
    }

    console.log(`[SUCCESS] User ${authenticatedUserId} deleted execution ${executionId} (workflow ${execution.workflow_id})`);

    return NextResponse.json({
      success: true,
      message: 'Execution deleted successfully'
    });

  } catch (error) {
    console.error('Error in delete execution endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}