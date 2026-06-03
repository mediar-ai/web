-- Add per-schedule default inputs for cloud cron runs.
--
-- Why: the cloud cron scheduler (apps/web/src/app/api/cron/scheduler/route.ts)
-- previously sent `parameters: {}` for every scheduled run, so scheduled
-- executions always fell back to the workflow version's built-in input
-- defaults (e.g. `environment` => "UAT") with no way to set them from the
-- Schedule tab. This column stores the input values chosen for the schedule
-- and is passed as `parameters` on each cron-triggered execution.
--
-- This mirrors the desktop scheduler's existing `default_inputs` behavior
-- (apps/desktop/src-tauri/src/workflow_scheduler.rs).
--
-- Non-destructive, additive, idempotent.

ALTER TABLE deployed_workflows
  ADD COLUMN IF NOT EXISTS cron_default_inputs jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN deployed_workflows.cron_default_inputs IS
  'Input values passed as execution parameters to scheduled (cron) runs. Set via the Schedule tab. Defaults to {} (workflow falls back to its own input defaults).';
