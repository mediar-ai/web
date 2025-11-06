import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/remote-workflows/executions/[executionId]/results
 * Fetch the results field for a specific execution
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  const { executionId } = await params;

  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to execution results');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Missing required environment variables' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get execution WITH workflow info for authorization check
    const { data: execution, error } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        results,
        deployed_workflows!inner(
          id,
          name,
          created_by,
          organization_id
        )
      `)
      .eq('id', executionId)
      .single();

    if (error || !execution) {
      return NextResponse.json(
        {
          success: false,
          error: error?.message || 'Execution not found'
        },
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

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any execution results)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized access to execution ${executionId} results`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this execution' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        execution: {
          id: execution.id,
          workflow_id: execution.workflow_id,
          status: execution.status,
          results: execution.results
        }
      }
    );
  } catch (error) {
    console.error('Error fetching execution results:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 200 });
}
