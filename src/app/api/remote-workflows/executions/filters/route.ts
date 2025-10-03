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

    // Mediar org sees all workflows, OR Mediar admin not viewing a specific org
    if (isMediarOrg || (isMediarAdmin && !viewOrgId)) {
      const { data: allWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id');
      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
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
    }

    if (accessibleWorkflowIds.length === 0) {
      return NextResponse.json({
        success: true,
        filters: { workflowNames: [], statuses: [], machines: [] },
      });
    }

    // Fetch unique workflow names from accessible workflows
    const { data: workflowsData } = await supabase
      .from('deployed_workflows')
      .select('name')
      .in('id', accessibleWorkflowIds)
      .order('name');

    const uniqueWorkflowNames = workflowsData
      ? Array.from(new Set(workflowsData.map((w: any) => w.name).filter(Boolean))).sort()
      : [];

    // Fetch unique statuses from executions of accessible workflows
    const { data: statusesData } = await supabase
      .from('workflow_executions')
      .select('status')
      .in('workflow_id', accessibleWorkflowIds)
      .order('status');

    const uniqueStatuses = statusesData
      ? Array.from(new Set(statusesData.map((e: any) => e.status).filter(Boolean))).sort()
      : [];

    // Fetch unique machines from executions of accessible workflows
    const { data: machinesData } = await supabase
      .from('workflow_executions')
      .select('assigned_machine_name')
      .in('workflow_id', accessibleWorkflowIds)
      .not('assigned_machine_name', 'is', null)
      .order('assigned_machine_name');

    const uniqueMachines = machinesData
      ? Array.from(new Set(machinesData.map((e: any) => e.assigned_machine_name).filter(Boolean))).sort()
      : [];

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
