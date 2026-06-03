-- Frozen monthly billing snapshots.
-- Once a month ends, the freeze-billing-month cron captures the numbers from
-- workflow_executions + deployed_workflows and writes one row here. The billing
-- API then serves these rows for past months instead of recomputing.
--
-- One row per (organization, month). The `data` blob is the full month entry
-- the API returns to clients, so the page can render it directly.

CREATE TABLE IF NOT EXISTS billing_snapshots (
    id BIGSERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    month_key TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
    data JSONB NOT NULL,
    frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, month_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_snapshots_org_month
    ON billing_snapshots (organization_id, month_key DESC);

ALTER TABLE billing_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role only (server-side reads/writes via supabase admin client).
-- Clients never hit this table directly; they go through the /api/billing/usage route.
--
-- Historical snapshots are seeded per environment out-of-band (not committed here),
-- since they contain customer-specific frozen billing figures. The freeze-billing-month
-- cron writes future months automatically.
