import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEffectiveOrgId } from '@/lib/mediarAuth';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const viewOrgId = searchParams.get('viewOrgId');

    // Get effective organization context
    const { orgId, isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(
      viewOrgId === 'ALL' ? null : viewOrgId
    );

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'No organization context' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get workflow IDs this organization has access to (same logic as executions endpoint)
    let accessibleWorkflowIds: number[] = [];

    console.log('[Filters API] orgId:', orgId, 'isMediarOrg:', isMediarOrg, 'isMediarAdmin:', isMediarAdmin);

    // Show all workflows if Mediar admin explicitly selected "All Orgs"
    const showAllWorkflows = isMediarAdmin && viewOrgId === 'ALL';

    if (showAllWorkflows) {
      const { data: allWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id');
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
      console.log('[Filters API] Mediar Admin viewing all orgs - accessible workflows:', accessibleWorkflowIds.length);
    } else {
      // Regular org sees only their workflows and shared workflows
      const { data: ownedWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('organization_id', orgId);

      const { data: sharedAccess } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id')
        .eq('organization_id', orgId);

      const ownedIds = (ownedWorkflows || []).map(w => w.id);
      const sharedIds = (sharedAccess || []).map(a => a.workflow_id);
      accessibleWorkflowIds = [...new Set([...ownedIds, ...sharedIds])];
      console.log('[Filters API] Regular org - owned:', ownedIds.length, 'shared:', sharedIds.length, 'total:', accessibleWorkflowIds.length);
    }

    if (accessibleWorkflowIds.length === 0) {
      console.log('[Filters API] No accessible workflows, returning empty filters');
      return NextResponse.json({
        success: true,
        filters: { workflowNames: [], statuses: [], machines: [] },
      });
    }

    // Fetch unique workflow names from accessible workflows
    const { data: workflowsData, error: workflowsError } = await supabase
      .from('deployed_workflows')
      .select('name')
      .in('id', accessibleWorkflowIds)
      .order('name');

    if (workflowsError) {
      console.error('[Filters API] Error fetching workflows:', workflowsError);
    }

    const uniqueWorkflowNames = workflowsData
      ? Array.from(new Set(workflowsData.map((w: any) => w.name).filter(Boolean))).sort()
      : [];
    console.log('[Filters API] Workflow names:', uniqueWorkflowNames.length, uniqueWorkflowNames);

    // Return all possible statuses (database + derived)
    // Database statuses: cancelled, completed, failed, queued, running
    // Derived statuses: EXCEPTION (from formatted_output.exception=true), SKIPPED (from formatted_output.skipped=true)
    // Note: We hardcode this list because querying for all distinct statuses is inefficient
    // (would require fetching thousands of rows or using a separate COUNT DISTINCT query)
    const uniqueStatuses = [
      'cancelled',
      'completed',
      'EXCEPTION',
      'failed',
      'queued',
      'running',
      'SKIPPED'
    ].sort();
    console.log('[Filters API] Statuses:', uniqueStatuses.length, uniqueStatuses);

    // Fetch machines that the user's organization has access to
    // Use check_machine_access function to filter by organization
    const { data: allMachinesData, error: machinesError } = await supabase
      .from('remote_machines')
      .select('id, name, is_global')
      .order('name');

    if (machinesError) {
      console.error('[Filters API] Error fetching machines:', machinesError);
    }

    console.log(`[Filters API] Total machines in DB: ${allMachinesData?.length || 0}, checking access for org: ${orgId}`);

    // Filter machines by organization access
    const accessibleMachines = [];
    if (allMachinesData) {
      for (const machine of allMachinesData) {
        const { data: hasAccess, error: accessError } = await supabase
          .rpc('check_machine_access', {
            p_machine_id: machine.id,
            p_organization_id: orgId
          });

        if (accessError) {
          console.error(`[Filters API] Failed to check access for machine ${machine.id} (${machine.name}):`, accessError);
          continue;
        }

        console.log(`[Filters API] Machine "${machine.name}" (id:${machine.id}, is_global:${machine.is_global}) -> hasAccess: ${hasAccess}`);

        if (hasAccess) {
          accessibleMachines.push(machine.name);
        }
      }
    }

    const uniqueMachines = Array.from(new Set(accessibleMachines.filter(Boolean))).sort();
    console.log(`[Filters API] Final accessible machines for org ${orgId}: ${uniqueMachines.length}`, uniqueMachines);

    return NextResponse.json({
      success: true,
      filters: {
        workflowNames: uniqueWorkflowNames,
        statuses: uniqueStatuses,
        machines: uniqueMachines,
      },
    });
  } catch (error) {
    console.error('Error fetching execution filters:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch filters' },
      { status: 500 }
    );
  }
}
