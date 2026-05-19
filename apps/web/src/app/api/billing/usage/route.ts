import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { mapClerkIdToDbId } from '@/lib/orgIdMapping';
import ExampleClientSnapshots from '@/data/billing-snapshots/ExampleClient.json';

// Pricing (ExampleClient pilot terms). Display-only constants returned in
// the response payload so the page can show "rate" lines on the invoice. The
// SNAPSHOT is the source of truth for everything billed; these constants do
// NOT participate in any recomputation here.
const RATE_PER_MINUTE = 0.15;
const MIN_CHARGE_PER_WORKFLOW = 500;

// ExampleClient organization ID
const ExampleClient_ORG = 'org_REDACTED';

// Production shipped on 2025-10-02 (workflow 71 created_at). Pilot start date,
// surfaced to the page for display in the invoice header.
const PILOT_START_DATE = '2025-10-02';

// Frozen monthly billing snapshot. Produced by the freeze cron
// (`/api/cron/freeze-billing-month`) on the 2nd of each month from the prior
// month's raw `workflow_executions`. Once written, the snapshot is the SOLE
// source of truth for that month's invoice. This route never recomputes
// numbers from raw executions; it only reads snapshots.
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
  if (orgId === ExampleClient_ORG) {
    return (ExampleClientSnapshots.frozenMonths || {}) as Record<
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
      : userOrgId || (isMediarAdmin ? ExampleClient_ORG : null);

    if (!orgId) {
      return NextResponse.json(
        { error: 'No organization selected. Please activate an organization to view billing.' },
        { status: 400 }
      );
    }

    // SINGLE SOURCE OF TRUTH: `billing_snapshots` table. The freeze cron
    // (`/api/cron/freeze-billing-month`) is the only producer; this route is
    // a pure read. No live recomputation from `workflow_executions`. Deleting
    // a snapshot row makes the month disappear, full stop. Adding a snapshot
    // row makes it appear. The cron + the table together are the contract.
    const frozenSnapshots = await getFrozenSnapshots(orgId);

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const months = Object.entries(frozenSnapshots)
      .filter(([monthKey]) => monthKey !== currentMonthKey)
      .map(([, snapshot]) => ({
        ...snapshot,
        frozen: true as const,
        frozenAt: snapshot.frozenAt,
      }))
      .sort((a, b) => b.key.localeCompare(a.key));

    return NextResponse.json({
      ratePerMinute: RATE_PER_MINUTE,
      minPerWorkflow: MIN_CHARGE_PER_WORKFLOW,
      pilotStartDate: PILOT_START_DATE,
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
