import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import { getEffectiveOrgId } from '@/lib/mediarAuth';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const viewOrgId = searchParams.get('viewOrgId');
    const { orgId: effectiveOrgId } = await getEffectiveOrgId(viewOrgId);

    // Fetch unique workflow names
    const { data: workflowsData } = await supabase
      .from('workflows')
      .select('name')
      .eq('organization_id', effectiveOrgId)
      .order('name');

    const uniqueWorkflowNames = workflowsData
      ? Array.from(new Set(workflowsData.map((w: any) => w.name).filter(Boolean))).sort()
      : [];

    // Fetch unique statuses
    const { data: statusesData } = await supabase
      .from('workflow_executions')
      .select('status')
      .eq('organization_id', effectiveOrgId)
      .order('status');

    const uniqueStatuses = statusesData
      ? Array.from(new Set(statusesData.map((e: any) => e.status).filter(Boolean))).sort()
      : [];

    // Fetch unique machines
    const { data: machinesData } = await supabase
      .from('workflow_executions')
      .select('assigned_machine_name')
      .eq('organization_id', effectiveOrgId)
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
