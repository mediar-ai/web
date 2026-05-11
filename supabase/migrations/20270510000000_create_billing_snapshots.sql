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

-- Seed Imperial Treasure historical months (Oct 2025 - Apr 2026).
-- Pre-May months are estimated for Oct-Dec/early-Jan; actuals for the rest.
-- See apps/web/src/data/billing-snapshots/imperial-treasure.json for source of truth.
INSERT INTO billing_snapshots (organization_id, month_key, data, frozen_at) VALUES
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2025-10', '{
  "key": "2025-10", "name": "October 2025",
  "estimated": true, "partiallyEstimated": false,
  "workflowCount": 1, "minimumCharge": 500, "minimumApplied": false,
  "workflows": [{"id": 71, "name": "[71] SAP Journal Entry", "executions": 1156, "totalMinutes": 5718, "usageCost": 857.7, "billedCost": 857.7, "minimumApplied": false, "estimated": true}],
  "totalMinutes": 5718, "usageCost": 857.7, "totalCost": 857.7
}', '2026-05-10T00:00:00Z'),
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2025-11', '{
  "key": "2025-11", "name": "November 2025",
  "estimated": true, "partiallyEstimated": false,
  "workflowCount": 1, "minimumCharge": 500, "minimumApplied": false,
  "workflows": [{"id": 71, "name": "[71] SAP Journal Entry", "executions": 1156, "totalMinutes": 5718, "usageCost": 857.7, "billedCost": 857.7, "minimumApplied": false, "estimated": true}],
  "totalMinutes": 5718, "usageCost": 857.7, "totalCost": 857.7
}', '2026-05-10T00:00:00Z'),
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2025-12', '{
  "key": "2025-12", "name": "December 2025",
  "estimated": true, "partiallyEstimated": false,
  "workflowCount": 1, "minimumCharge": 500, "minimumApplied": false,
  "workflows": [{"id": 71, "name": "[71] SAP Journal Entry", "executions": 1194, "totalMinutes": 5910, "usageCost": 886.5, "billedCost": 886.5, "minimumApplied": false, "estimated": true}],
  "totalMinutes": 5910, "usageCost": 886.5, "totalCost": 886.5
}', '2026-05-10T00:00:00Z'),
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2026-01', '{
  "key": "2026-01", "name": "January 2026",
  "estimated": false, "partiallyEstimated": true,
  "workflowCount": 1, "minimumCharge": 500, "minimumApplied": false,
  "workflows": [{"id": 71, "name": "[71] SAP Journal Entry", "executions": 1041, "totalMinutes": 4950, "usageCost": 742.5, "billedCost": 742.5, "minimumApplied": false, "estimated": true}],
  "totalMinutes": 4950, "usageCost": 742.5, "totalCost": 742.5
}', '2026-05-10T00:00:00Z'),
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2026-02', '{
  "key": "2026-02", "name": "February 2026",
  "estimated": false, "partiallyEstimated": false,
  "workflowCount": 1, "minimumCharge": 500, "minimumApplied": false,
  "workflows": [{"id": 71, "name": "[71] SAP Journal Entry", "executions": 1082, "totalMinutes": 4158, "usageCost": 623.7, "billedCost": 623.7, "minimumApplied": false, "estimated": false}],
  "totalMinutes": 4158, "usageCost": 623.7, "totalCost": 623.7
}', '2026-05-10T00:00:00Z'),
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2026-03', '{
  "key": "2026-03", "name": "March 2026",
  "estimated": false, "partiallyEstimated": false,
  "workflowCount": 1, "minimumCharge": 500, "minimumApplied": false,
  "workflows": [{"id": 71, "name": "[71] SAP Journal Entry", "executions": 823, "totalMinutes": 3978, "usageCost": 596.7, "billedCost": 596.7, "minimumApplied": false, "estimated": false}],
  "totalMinutes": 3978, "usageCost": 596.7, "totalCost": 596.7
}', '2026-05-10T00:00:00Z'),
('org_33DH72nPyAInVAh5t8TyIKVdYNw', '2026-04', '{
  "key": "2026-04", "name": "April 2026",
  "estimated": false, "partiallyEstimated": false,
  "workflowCount": 2, "minimumCharge": 1000, "minimumApplied": true,
  "workflows": [
    {"id": 71, "name": "[71] SAP Journal Entry", "executions": 741, "totalMinutes": 4440, "usageCost": 666.0, "billedCost": 666.0, "minimumApplied": false, "estimated": false},
    {"id": -1, "name": "Deployed Workflow #2", "executions": 0, "totalMinutes": 0, "usageCost": 0.0, "billedCost": 500.0, "minimumApplied": true, "estimated": false}
  ],
  "totalMinutes": 4440, "usageCost": 666.0, "totalCost": 1166.0
}', '2026-05-10T00:00:00Z')
ON CONFLICT (organization_id, month_key) DO NOTHING;
