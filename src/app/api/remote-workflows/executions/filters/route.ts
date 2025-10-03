import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getEffectiveOrgId } from '@/lib/mediarAuth';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const viewOrgId = searchParams.get('viewOrgId');

    // Get effective organization context
    const { orgId, isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(viewOrgId);

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'No organization context' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get workflow IDs this organization has access to (same logic as executions endpoint)
    let accessibleWorkflowIds: number[] = [];

    console.log('[Filters API] orgId:', orgId, 'isMediarOrg:', isMediarOrg, 'isMediarAdmin:', isMediarAdmin);

    // Mediar org sees all workflows, OR Mediar admin not viewing a specific org
    if (isMediarOrg || (isMediarAdmin && !viewOrgId)) {
      const { data: allWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id');
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
      console.log('[Filters API] Mediar/Admin - accessible workflows:', accessibleWorkflowIds.length);
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

    // Fetch unique statuses from executions of accessible workflows
    const { data: statusesData, error: statusesError } = await supabase
      .from('workflow_executions')
      .select('status')
      .in('workflow_id', accessibleWorkflowIds)
      .order('status');

    if (statusesError) {
      console.error('[Filters API] Error fetching statuses:', statusesError);
    }

    const uniqueStatuses = statusesData
      ? Array.from(new Set(statusesData.map((e: any) => e.status).filter(Boolean))).sort()
      : [];
    console.log('[Filters API] Statuses:', uniqueStatuses.length, uniqueStatuses);

    // Fetch ALL machines from remote_machines table (no org filtering - table has no organization_id column)
    const { data: machinesData, error: machinesError } = await supabase
      .from('remote_machines')
      .select('name')
      .order('name');

    if (machinesError) {
      console.error('[Filters API] Error fetching machines:', machinesError);
    }

    const uniqueMachines = machinesData
      ? Array.from(new Set(machinesData.map((m: any) => m.name).filter(Boolean))).sort()
      : [];
    console.log('[Filters API] Machines:', uniqueMachines.length, uniqueMachines);

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
