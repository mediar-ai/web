import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * Monthly billing freeze cron.
 *
 * Runs on the 2nd of each month (gives some buffer for late-arriving rows).
 * For each tracked customer, computes the previous month's billing from
 * `workflow_executions` and upserts one row into `billing_snapshots`.
 * Past months become immutable once frozen.
 *
 * Vercel schedule: "0 4 2 * *" (2nd of month, 04:00 UTC)
 */

// Pricing (must match /api/billing/usage/route.ts).
const RATE_PER_MINUTE = 0.15;
const MIN_CHARGE_PER_WORKFLOW = 500;

// Per-customer billing rules live in the `billing_config` Supabase table, NOT
// in this (public) repository. Each row is one customer:
//
//   organization_id  TEXT   the org to freeze
//   name             TEXT   display name for logs
//   rules            JSONB  {
//                             workflowNameOverrides?: { [id]: string },
//                             billableRules?: Array<{ minMonth: string|null, workflowIds: number[] }>
//                           }
//
// `billableRules` is evaluated newest-first: the first rule whose `minMonth`
// is null OR <= the target month wins, and its `workflowIds` are billed. When
// a customer has no `billableRules`, all prod workflows are billable every
// month (the default). This keeps customer-specific workflow IDs, internal
// workflow names, and any billing-dispute cutoffs out of source control.
type BillableRule = { minMonth: string | null; workflowIds: number[] };
type BillingRules = {
  workflowNameOverrides?: Record<string, string>;
  billableRules?: BillableRule[];
};
type CustomerConfig = {
  orgId: string;
  name: string;
  rules: BillingRules;
};

async function getCustomers(): Promise<CustomerConfig[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('billing_config')
    .select('organization_id, name, rules');

  if (error) {
    throw error;
  }

  return (data || []).map(row => ({
    orgId: row.organization_id as string,
    name: (row.name as string) || (row.organization_id as string),
    rules: (row.rules as BillingRules) || {},
  }));
}

function getBillableWorkflowIdsForOrg(
  rules: BillingRules,
  monthKey: string,
  allProdIds: number[]
): number[] {
  const billableRules = rules.billableRules;
  if (billableRules && billableRules.length > 0) {
    const sorted = [...billableRules].sort((a, b) =>
      (b.minMonth || '').localeCompare(a.minMonth || '')
    );
    for (const rule of sorted) {
      if (rule.minMonth === null || rule.minMonth === undefined || monthKey >= rule.minMonth) {
        return rule.workflowIds;
      }
    }
  }
  // Default: all prod workflows are billable every month.
  return allProdIds;
}

function previousMonthKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthBounds(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1)); // exclusive
  return { start: start.toISOString(), end: end.toISOString() };
}

function monthDisplayName(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
}

type FreezeResult = {
  orgId: string;
  monthKey: string;
  status: 'frozen' | 'already_frozen' | 'no_data' | 'error';
  totalCost?: number;
  error?: string;
};

async function freezeMonthForOrg(
  orgId: string,
  monthKey: string,
  rules: BillingRules
): Promise<FreezeResult> {
  const admin = getSupabaseAdmin();
  const nameOverrides = rules.workflowNameOverrides || {};

  // Idempotency: skip if already frozen.
  const { data: existing } = await admin
    .from('billing_snapshots')
    .select('id')
    .eq('organization_id', orgId)
    .eq('month_key', monthKey)
    .maybeSingle();

  if (existing) {
    return { orgId, monthKey, status: 'already_frozen' };
  }

  // 1. Fetch prod workflows for the org.
  const { data: prodWorkflows, error: wfErr } = await admin
    .from('deployed_workflows')
    .select('id, name')
    .contains('tags', ['prod'])
    .eq('organization_id', orgId);

  if (wfErr) {
    return { orgId, monthKey, status: 'error', error: wfErr.message };
  }
  if (!prodWorkflows || prodWorkflows.length === 0) {
    return { orgId, monthKey, status: 'no_data' };
  }

  const prodIds = prodWorkflows.map(w => w.id);
  const workflowNames: Record<number, string> = {};
  prodWorkflows.forEach(w => {
    workflowNames[w.id] = w.name;
  });

  // 2. Fetch completed executions for the month, paginated.
  const { start, end } = monthBounds(monthKey);
  const monthlyByWf: Record<
    number,
    { executions: number; totalMinutes: number }
  > = {};

  const PAGE = 1000;
  let page = 0;
  while (page < 100) {
    const { data, error } = await admin
      .from('workflow_executions')
      .select('workflow_id, execution_duration_seconds, started_at')
      .in('workflow_id', prodIds)
      .eq('status', 'completed')
      .gte('started_at', start)
      .lt('started_at', end)
      .range(page * PAGE, (page + 1) * PAGE - 1);

    if (error) {
      return { orgId, monthKey, status: 'error', error: error.message };
    }
    if (!data || data.length === 0) break;

    for (const exec of data) {
      const wfId = exec.workflow_id;
      if (!monthlyByWf[wfId]) monthlyByWf[wfId] = { executions: 0, totalMinutes: 0 };
      monthlyByWf[wfId].executions += 1;
      monthlyByWf[wfId].totalMinutes +=
        (exec.execution_duration_seconds || 0) / 60;
    }
    if (data.length < PAGE) break;
    page++;
  }

  // 3. Apply per-workflow $500 floor + bill rules.
  const billableIds = getBillableWorkflowIdsForOrg(rules, monthKey, prodIds);
  const workflows = billableIds.map(id => {
    const usage = monthlyByWf[id];
    if (usage) {
      const usageCost =
        Math.round(usage.totalMinutes * RATE_PER_MINUTE * 100) / 100;
      const billedCost = Math.max(usageCost, MIN_CHARGE_PER_WORKFLOW);
      return {
        id,
        name:
          workflowNames[id] || nameOverrides[String(id)] || `Workflow #${id}`,
        executions: usage.executions,
        totalMinutes: Math.round(usage.totalMinutes * 10) / 10,
        usageCost,
        billedCost: Math.round(billedCost * 100) / 100,
        minimumApplied: billedCost > usageCost + 0.01,
      };
    }
    const name =
      workflowNames[id] || nameOverrides[String(id)] || `Workflow #${id}`;
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

  const totalMinutes = workflows.reduce((s, w) => s + w.totalMinutes, 0);
  const usageCost = workflows.reduce((s, w) => s + w.usageCost, 0);
  const totalCost = workflows.reduce((s, w) => s + w.billedCost, 0);
  const minimumApplied = workflows.some(w => w.minimumApplied);

  const monthData = {
    key: monthKey,
    name: monthDisplayName(monthKey),
    workflowCount: billableIds.length,
    minimumCharge: billableIds.length * MIN_CHARGE_PER_WORKFLOW,
    minimumApplied,
    workflows,
    totalMinutes: Math.round(totalMinutes * 10) / 10,
    usageCost: Math.round(usageCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };

  const { error: insertErr } = await admin.from('billing_snapshots').insert({
    organization_id: orgId,
    month_key: monthKey,
    data: monthData,
    frozen_at: new Date().toISOString(),
  });

  if (insertErr) {
    return { orgId, monthKey, status: 'error', error: insertErr.message };
  }

  return { orgId, monthKey, status: 'frozen', totalCost: monthData.totalCost };
}

async function handle(request: NextRequest) {
  // Auth: Vercel cron user-agent OR CRON_SECRET bypass token.
  const userAgent = request.headers.get('user-agent') || '';
  const isVercelCron = userAgent.includes('vercel-cron');

  if (!isVercelCron) {
    const url = new URL(request.url);
    const token =
      url.searchParams.get('x-vercel-protection-bypass') ||
      request.headers.get('x-vercel-protection-bypass') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Allow ?month=YYYY-MM override for manual replays (idempotent anyway).
  const url = new URL(request.url);
  const overrideMonth = url.searchParams.get('month');
  const targetMonth = overrideMonth || previousMonthKey(new Date());

  // Refuse to freeze the current month.
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (targetMonth === currentMonth) {
    return NextResponse.json(
      { error: `Refusing to freeze the current month (${currentMonth})` },
      { status: 400 }
    );
  }

  console.log(`[freeze-billing-month] Target month: ${targetMonth}`);

  let customers: CustomerConfig[];
  try {
    customers = await getCustomers();
  } catch (e) {
    return NextResponse.json(
      {
        error: 'Failed to load billing_config',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }

  const results: FreezeResult[] = [];
  for (const customer of customers) {
    try {
      const r = await freezeMonthForOrg(customer.orgId, targetMonth, customer.rules);
      results.push(r);
      console.log(
        `[freeze-billing-month] ${customer.name} ${targetMonth}: ${r.status}${
          r.totalCost !== undefined ? ` ($${r.totalCost})` : ''
        }${r.error ? ` (${r.error})` : ''}`
      );
    } catch (e) {
      results.push({
        orgId: customer.orgId,
        monthKey: targetMonth,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    targetMonth,
    results,
  });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request); // Vercel cron uses GET
}
