import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';

// Pricing: $0.50 per minute of execution
const RATE_PER_MINUTE = 0.5;

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Get executions from the last 60 days with duration data
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: executions, error } = await supabase
      .from('workflow_executions')
      .select(
        `
        id,
        workflow_id,
        status,
        execution_duration_seconds,
        started_at,
        completed_at,
        deployed_workflows!inner(id, name, organization_id)
      `
      )
      .gte('started_at', sixtyDaysAgo.toISOString())
      .order('started_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch executions:', error);
      return NextResponse.json(
        { error: 'Failed to fetch data' },
        { status: 500 }
      );
    }

    // Group by month and workflow
    const monthlyData: Record<
      string,
      {
        workflows: Record<
          number,
          {
            name: string;
            executions: number;
            totalMinutes: number;
            cost: number;
          }
        >;
        totalMinutes: number;
        totalCost: number;
      }
    > = {};

    for (const exec of executions || []) {
      if (!exec.started_at) continue;

      const date = new Date(exec.started_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { workflows: {}, totalMinutes: 0, totalCost: 0 };
      }

      const workflowId = exec.workflow_id;
      // deployed_workflows is an object from the inner join
      const deployedWorkflow = exec.deployed_workflows as unknown as { name: string } | null;
      const workflowName = deployedWorkflow?.name || 'Unknown';
      const durationMinutes = (exec.execution_duration_seconds || 0) / 60;

      if (!monthlyData[monthKey].workflows[workflowId]) {
        monthlyData[monthKey].workflows[workflowId] = {
          name: workflowName,
          executions: 0,
          totalMinutes: 0,
          cost: 0,
        };
      }

      monthlyData[monthKey].workflows[workflowId].executions += 1;
      monthlyData[monthKey].workflows[workflowId].totalMinutes += durationMinutes;
      monthlyData[monthKey].workflows[workflowId].cost +=
        durationMinutes * RATE_PER_MINUTE;

      monthlyData[monthKey].totalMinutes += durationMinutes;
      monthlyData[monthKey].totalCost += durationMinutes * RATE_PER_MINUTE;
    }

    // Format response
    const months = Object.entries(monthlyData)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, data]) => {
        const [year, monthNum] = month.split('-');
        const monthName = new Date(
          parseInt(year),
          parseInt(monthNum) - 1
        ).toLocaleString('default', { month: 'long', year: 'numeric' });

        return {
          key: month,
          name: monthName,
          workflows: Object.entries(data.workflows).map(([id, wf]) => ({
            id: parseInt(id),
            name: wf.name,
            executions: wf.executions,
            totalMinutes: Math.round(wf.totalMinutes * 10) / 10,
            cost: Math.round(wf.cost * 100) / 100,
          })),
          totalMinutes: Math.round(data.totalMinutes * 10) / 10,
          totalCost: Math.round(data.totalCost * 100) / 100,
        };
      });

    return NextResponse.json({
      ratePerMinute: RATE_PER_MINUTE,
      months,
    });
  } catch (error) {
    console.error('Billing usage error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
