import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// POST /api/remote-workflows/[workflowId]/optimal-machine - Get optimal machine for workflow
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to optimal machine');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    // STEP 2: Get workflow ownership data and verify authorization
    const { data: workflowOwnership, error: ownershipError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (ownershipError || !workflowOwnership) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflowOwnership.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflowOwnership.organization_id && workflowOwnership.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
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
    // - User is in Mediar org or is a Mediar admin (can get optimal machine for any workflow)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized optimal machine check for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const execution_params = body.execution_params || {};

    console.log(`🔍 Getting optimal machine assignment for workflow ${workflowIdNum}...`);
    
    // Use the same database function as the backend execution routes
    const { data: optimalMachine, error: optimalError } = await supabase
      .rpc('get_optimal_machine_for_workflow', {
        p_workflow_id: workflowIdNum,
        p_execution_params: execution_params
      });

    if (!optimalError && optimalMachine && optimalMachine.length > 0) {
      // Use optimal machine assignment
      const machine = optimalMachine[0];
      const assigned_machine_id = machine.machine_id;
      const assignment_reason = machine.assignment_reason;
      const machine_name = machine.machine_name;
      
      console.log(`[SUCCESS] Optimal machine for workflow ${workflowIdNum}: ${machine_name} (ID: ${assigned_machine_id}) - ${assignment_reason}`);
      
      return NextResponse.json({
        success: true,
        machine_id: assigned_machine_id,
        machine_name: machine_name,
        assignment_reason: assignment_reason,
        load_percentage: machine.load_percentage
      });
    } else {
      // Fallback to machine 1 (same as backend fallback behavior)
      console.log(`[INFO] No optimal machine found for workflow ${workflowIdNum}, using fallback Machine 1`);
      
      // Get machine 1 details for consistent response
      const { data: fallbackMachine, error: fallbackError } = await supabase
        .from('remote_machines')
        .select('id, name')
        .eq('id', 1)
        .single();

      if (fallbackError || !fallbackMachine) {
        return NextResponse.json(
          { success: false, error: 'No machines available' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        machine_id: 1,
        machine_name: fallbackMachine.name,
        assignment_reason: 'Fallback to default machine',
        load_percentage: 0
      });
    }

  } catch (error) {
    console.error('[ERROR] Failed to get optimal machine:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get optimal machine assignment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
