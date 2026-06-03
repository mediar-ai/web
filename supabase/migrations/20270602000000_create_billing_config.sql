-- Per-customer billing configuration.
--
-- The freeze-billing-month cron (apps/web/src/app/api/cron/freeze-billing-month)
-- reads one row per customer from this table to decide which org to freeze,
-- which workflows are billable for a given month, and any display-name
-- overrides. Keeping this in the database (not in source) lets us onboard new
-- customers and encode customer-specific billing rules / dispute cutoffs
-- without committing customer-identifying data to a public repository.
--
-- rules JSONB shape:
--   {
--     "workflowNameOverrides": { "<workflowId>": "Display Name" },
--     "billableRules": [
--       { "minMonth": "YYYY-MM" | null, "workflowIds": [<id>, ...] }
--     ]
--   }
-- billableRules is evaluated newest-first: the first rule whose minMonth is
-- null or <= the target month wins. With no billableRules, every prod workflow
-- is billable each month (the default).

CREATE TABLE IF NOT EXISTS billing_config (
    organization_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_config ENABLE ROW LEVEL SECURITY;

-- Service role only (server-side reads via the supabase admin client). Clients
-- never hit this table directly. Customer rows are seeded per-environment out
-- of band (see scripts/seed-billing-config.mjs), never in this public migration.
