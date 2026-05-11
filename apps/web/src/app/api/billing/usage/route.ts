import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createServerClient, getSupabaseAdmin } from '@/lib/supabase-server';
import { mapClerkIdToDbId } from '@/lib/orgIdMapping';
import imperialTreasureSnapshots from '@/data/billing-snapshots/imperial-treasure.json';

// Pricing (Imperial Treasure pilot terms):
// - $0.15 per minute of successfully completed workflow execution
// - $500 minimum monthly charge per deployed (prod) workflow
// - Only `status = 'completed'` runs are billable; failed/skipped/cancelled do not count
const RATE_PER_MINUTE = 0.15;
const MIN_CHARGE_PER_WORKFLOW = 500;

// Imperial Treasure organization ID
const IMPERIAL_TREASURE_ORG = 'org_33DH72nPyAInVAh5t8TyIKVdYNw';

// Production shipped on 2025-10-02 (workflow 71 created_at). Billing starts here.
const PILOT_START_DATE = '2025-10-02';

// Imperial Treasure deployed workflows by month.
// Each entry is the list of workflow IDs that are billable that month.
// Workflows that had zero executions still incur the $500 per-workflow minimum.
//
// Oct 2025 → Mar 2026: only workflow 71 (SAP Journal Entry).
// Apr 2026 onward: workflow 71 + workflow 271 (Web Outgoing Payments).
const IT_WORKFLOW_SAP_JOURNAL = 71;
const IT_WORKFLOW_WEB_OUTGOING_PAYMENTS = 271;

function getBillableWorkflowIds(monthKey: string, _allProdIds: number[]): number[] {
  if (monthKey >= '2026-04') {
    return [IT_WORKFLOW_SAP_JOURNAL, IT_WORKFLOW_WEB_OUTGOING_PAYMENTS];
  }
  return [IT_WORKFLOW_SAP_JOURNAL];
}

// Hardcoded display names for billable workflows. The DB name is used when the
// workflow appears in prodList (i.e. it's tagged 'prod'); these are fallbacks
// for the case where the workflow exists but isn't prod-tagged yet.
const HARDCODED_WORKFLOW_NAMES: Record<number, string> = {
  [IT_WORKFLOW_SAP_JOURNAL]: 'SAP Journal Entry',
  [IT_WORKFLOW_WEB_OUTGOING_PAYMENTS]: 'Web Outgoing Payments',
};

// Frozen monthly billing snapshots.
// Once a month ends, its numbers are captured in a static JSON file and never
// recomputed. This prevents drift if execution data is later mutated/pruned.
// Currently only Imperial Treasure is wired in. Add more by importing another
// snapshot file and extending this map.
type FrozenMonth = {
  key: string;
  name: string;
  frozenAt: string;
  workflowCount: number;
  minimumCharge: number;
  minimumApplied: boolean;
  workflows: Array<{
    id: number;
    name: string;
    executions: number;
    totalMinutes: number;
    usageCost: number;
    billedCost: number;
    minimumApplied: boolean;
  }>;
  totalMinutes: number;
  usageCost: number;
  totalCost: number;
};

function getJsonFallbackSnapshots(orgId: string): Record<string, FrozenMonth> {
  if (orgId === IMPERIAL_TREASURE_ORG) {
    return (imperialTreasureSnapshots.frozenMonths || {}) as Record<
      string,
      FrozenMonth
    >;
  }
  return {};
}

// Reads frozen month snapshots from Supabase (`billing_snapshots` table).
// If Supabase is empty (or the table doesn't exist yet), falls back to the
// static JSON file. This makes the freeze story durable across deploys while
// still working in local dev before the migration is applied.
async function getFrozenSnapshots(
  orgId: string
): Promise<Record<string, FrozenMonth & { frozenAt: string }>> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('billing_snapshots')
      .select('month_key, data, frozen_at')
      .eq('organization_id', orgId);

    if (!error && data && data.length > 0) {
      const out: Record<string, FrozenMonth & { frozenAt: string }> = {};
      for (const row of data as Array<{
        month_key: string;
        data: FrozenMonth;
        frozen_at: string;
      }>) {
        out[row.month_key] = { ...row.data, frozenAt: row.frozen_at };
      }
      return out;
    }
  } catch (e) {
    console.warn('[billing] Supabase snapshot read failed, falling back to JSON:', e);
  }
  // Fallback: static JSON (used in dev before migration is applied)
  const json = getJsonFallbackSnapshots(orgId);
  const out: Record<string, FrozenMonth & { frozenAt: string }> = {};
  for (const [k, v] of Object.entries(json)) {
    out[k] = { ...v, frozenAt: v.frozenAt || new Date().toISOString() };
  }
  return out;
}

type WorkflowExecution = {
  id: number;
  workflow_id: number;
  status: string | null;
  execution_duration_seconds: number | null;
  started_at: string | null;
};

type ProdWorkflow = {
  id: number;
  name: string;
  tags: string[] | null;
  created_at: string | null;
  successful_runs: number | null;
};

export async function GET(request: Request) {
  try {
    const { userId, orgId: clerkOrgId, sessionClaims } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const explicitOrg = searchParams.get('org');

    // Mediar admins (matt@mediar.ai etc.) can pass ?org= to view any customer's
    // billing. Everyone else gets their own org's data.
    const email = (sessionClaims as { email?: string } | null)?.email || '';
    const isMediarAdmin = email.toLowerCase().endsWith('@mediar.ai');

    const userOrgId = clerkOrgId ? mapClerkIdToDbId(clerkOrgId) : null;
    const orgId = explicitOrg && isMediarAdmin
      ? explicitOrg
      : userOrgId || (isMediarAdmin ? IMPERIAL_TREASURE_ORG : null);

    if (!orgId) {
      return NextResponse.json(
        { error: 'No organization selected. Please activate an organization to view billing.' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // 1. Fetch all prod-tagged workflows for this org
    const { data: prodWorkflows, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, tags, created_at, successful_runs')
      .contains('tags', ['prod'])
      .eq('organization_id', orgId);

    if (workflowError) {
      console.error('Failed to fetch prod workflows:', workflowError);
      return NextResponse.json(
        { error: 'Failed to fetch workflows' },
        { status: 500 }
      );
    }

    if (!prodWorkflows || prodWorkflows.length === 0) {
      return NextResponse.json({
        ratePerMinute: RATE_PER_MINUTE,
        minPerWorkflow: MIN_CHARGE_PER_WORKFLOW,
        pilotStartDate: PILOT_START_DATE,
        months: [],
      });
    }

    const prodList = prodWorkflows as ProdWorkflow[];
    const prodWorkflowIds = prodList.map(w => w.id);
    const workflowNames: Record<number, string> = {};
    prodList.forEach(w => {
      workflowNames[w.id] = w.name;
    });

    // 2. Fetch ALL completed executions for these workflows.
    // Paginate because PostgREST default limit is 1000 rows.
    const allExecutions: WorkflowExecution[] = [];
    const PAGE_SIZE = 1000;
    let page = 0;
    while (true) {
      const { data, error } = await supabase
        .from('workflow_executions')
        .select(
          'id, workflow_id, status, execution_duration_seconds, started_at'
        )
        .in('workflow_id', prodWorkflowIds)
        .eq('status', 'completed')
        .order('started_at', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (error) {
        console.error('Failed to fetch executions:', error);
        return NextResponse.json(
          { error: 'Failed to fetch data' },
          { status: 500 }
        );
      }
      if (!data || data.length === 0) break;
      allExecutions.push(...(data as WorkflowExecution[]));
      if (data.length < PAGE_SIZE) break;
      page++;
      if (page > 100) break; // safety bound
    }

    // 3. Group actual completed runs into monthly buckets
    type WorkflowMonthData = {
      name: string;
      executions: number;
      totalMinutes: number;
    };
    type MonthData = {
      workflows: Record<number, WorkflowMonthData>;
    };
    const monthlyData: Record<string, MonthData> = {};

    const actualCountByWorkflow: Record<number, number> = {};
    const actualMinutesByWorkflow: Record<number, number> = {};

    for (const exec of allExecutions) {
      if (!exec.started_at) continue;
      const date = new Date(exec.started_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const wfId = exec.workflow_id;
      const durationMin = (exec.execution_duration_seconds || 0) / 60;

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { workflows: {} };
      }

      if (!monthlyData[monthKey].workflows[wfId]) {
        monthlyData[monthKey].workflows[wfId] = {
          name: workflowNames[wfId] || HARDCODED_WORKFLOW_NAMES[wfId] || 'Unknown',
          executions: 0,
          totalMinutes: 0,
        };
      }
      monthlyData[monthKey].workflows[wfId].executions += 1;
      monthlyData[monthKey].workflows[wfId].totalMinutes += durationMin;

      actualCountByWorkflow[wfId] = (actualCountByWorkflow[wfId] || 0) + 1;
      actualMinutesByWorkflow[wfId] =
        (actualMinutesByWorkflow[wfId] || 0) + durationMin;
    }

    // 4. Estimate the pre-table-prune period.
    // The `workflow_executions` table was pruned around mid-Jan 2026, losing
    // the row-level history from Oct 2 2025 → Jan 17 2026. The aggregate counter
    // `deployed_workflows.successful_runs` survived. We use the counter
    // difference to reconstruct missing successful runs and distribute them
    // uniformly across the missing day range, multiplied by the average
    // run duration observed in the surviving (post-prune) data.
    for (const wf of prodList) {
      const counterTotal = wf.successful_runs ?? 0;
      const actualCount = actualCountByWorkflow[wf.id] || 0;
      const missingRuns = Math.max(0, counterTotal - actualCount);
      if (missingRuns === 0) continue;

      const avgMinPerRun =
        actualCount > 0
          ? (actualMinutesByWorkflow[wf.id] || 0) / actualCount
          : 0;
      if (avgMinPerRun <= 0) continue;

      const missingMinutes = missingRuns * avgMinPerRun;

      // Distribute from workflow.created_at (clamped to PILOT_START_DATE) to
      // the earliest actual row for this workflow (or now if none).
      const startDate = new Date(
        wf.created_at && wf.created_at > PILOT_START_DATE
          ? wf.created_at
          : PILOT_START_DATE
      );
      // Earliest actual row for this workflow
      let earliestActual: Date | null = null;
      for (const exec of allExecutions) {
        if (exec.workflow_id === wf.id && exec.started_at) {
          earliestActual = new Date(exec.started_at);
          break; // executions are ordered ascending
        }
      }
      const endDate = earliestActual || new Date();
      if (endDate <= startDate) continue;

      const totalDays = Math.max(
        1,
        Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000)
      );

      // Walk month-by-month between startDate and endDate
      const cursor = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
      );
      while (cursor < endDate) {
        const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        const monthEnd = new Date(
          cursor.getFullYear(),
          cursor.getMonth() + 1,
          1
        );
        const periodEnd = monthEnd < endDate ? monthEnd : endDate;
        const daysInPeriod = Math.max(
          1,
          Math.floor((periodEnd.getTime() - cursor.getTime()) / 86_400_000)
        );

        const monthRuns = Math.round((missingRuns * daysInPeriod) / totalDays);
        const monthMinutes = (missingMinutes * daysInPeriod) / totalDays;

        if (monthRuns > 0 || monthMinutes > 0) {
          if (!monthlyData[monthKey]) {
            monthlyData[monthKey] = { workflows: {} };
          }

          if (!monthlyData[monthKey].workflows[wf.id]) {
            monthlyData[monthKey].workflows[wf.id] = {
              name: workflowNames[wf.id] || HARDCODED_WORKFLOW_NAMES[wf.id] || 'Unknown',
              executions: 0,
              totalMinutes: 0,
            };
          }

          monthlyData[monthKey].workflows[wf.id].executions += monthRuns;
          monthlyData[monthKey].workflows[wf.id].totalMinutes += monthMinutes;
        }

        cursor.setTime(periodEnd.getTime());
      }
    }

    // 5. Build response with PER-WORKFLOW min-charge logic.
    // For each month: charge max(workflow_usage_cost, $500) per deployed workflow,
    // then sum. Workflows with zero executions in a month still get the $500 floor
    // if they are deployed that month.
    const allProdIds = prodList.map(w => w.id);
    const months = Object.entries(monthlyData)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([monthKey, data]) => {
        const [year, monthNum] = monthKey.split('-');
        const monthName = new Date(
          parseInt(year),
          parseInt(monthNum) - 1
        ).toLocaleString('default', { month: 'long', year: 'numeric' });

        const billableIds = getBillableWorkflowIds(monthKey, allProdIds);
        const billableWorkflowCount = billableIds.length;
        const minimumCharge = billableWorkflowCount * MIN_CHARGE_PER_WORKFLOW;

        // Synthesize zero-usage entries for billable workflows that had no runs.
        const workflows = billableIds.map(id => {
          const wf = data.workflows[id];
          if (wf) {
            const usageCost =
              Math.round(wf.totalMinutes * RATE_PER_MINUTE * 100) / 100;
            const billedCost = Math.max(usageCost, MIN_CHARGE_PER_WORKFLOW);
            return {
              id,
              name: wf.name,
              executions: wf.executions,
              totalMinutes: Math.round(wf.totalMinutes * 10) / 10,
              usageCost,
              billedCost: Math.round(billedCost * 100) / 100,
              minimumApplied: billedCost > usageCost + 0.01,
            };
          }
          // Zero-usage entry for a deployed workflow with no runs that month.
          const name =
            workflowNames[id] || HARDCODED_WORKFLOW_NAMES[id] || `Workflow #${id}`;
          return {
            id,
            name,
            executions: 0,
            totalMinutes: 0,
            usageCost: 0,
            billedCost: MIN_CHARGE_PER_WORKFLOW,
            minimumApplied: true,
          };
        });

        const totalMinutes = workflows.reduce(
          (s, w) => s + w.totalMinutes,
          0
        );
        const usageCost = workflows.reduce((s, w) => s + w.usageCost, 0);
        const totalCost = workflows.reduce((s, w) => s + w.billedCost, 0);
        const minimumApplied = workflows.some(w => w.minimumApplied);

        return {
          key: monthKey,
          name: monthName,
          workflowCount: billableWorkflowCount,
          minimumCharge,
          minimumApplied,
          workflows,
          totalMinutes: Math.round(totalMinutes * 10) / 10,
          usageCost: Math.round(usageCost * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
        };
      });

    // 6. Overlay frozen monthly snapshots.
    // Once a month ends and gets frozen into the JSON snapshot file,
    // its numbers are locked. Only the current (unfrozen) month is computed live.
    const frozenSnapshots = await getFrozenSnapshots(orgId);
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const mergedMonthsMap: Record<string, (typeof months)[number] & { frozen?: boolean; frozenAt?: string }> = {};
    for (const m of months) mergedMonthsMap[m.key] = { ...m, frozen: false };

    for (const [monthKey, snapshot] of Object.entries(frozenSnapshots)) {
      if (monthKey === currentMonthKey) continue; // never freeze the current month
      mergedMonthsMap[monthKey] = {
        ...snapshot,
        frozen: true,
        frozenAt: snapshot.frozenAt,
      };
    }

    const mergedMonths = Object.values(mergedMonthsMap).sort((a, b) =>
      b.key.localeCompare(a.key)
    );

    return NextResponse.json({
      ratePerMinute: RATE_PER_MINUTE,
      minPerWorkflow: MIN_CHARGE_PER_WORKFLOW,
      pilotStartDate: PILOT_START_DATE,
      months: mergedMonths,
    });
  } catch (error) {
    console.error('Billing usage error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
