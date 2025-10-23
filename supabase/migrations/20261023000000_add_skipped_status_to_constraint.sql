-- Migration: Add 'skipped' status to workflow_executions constraint
-- Description: Updates CHECK constraint to allow 'skipped' status for workflows with no work to do
-- Date: 2025-10-23
-- Applied: 2025-10-23 (production database)

-- =============================================================================
-- 1. Update workflow_executions status constraint to include 'skipped'
-- =============================================================================

-- Drop the old constraint
ALTER TABLE workflow_executions
DROP CONSTRAINT IF EXISTS workflow_executions_status_check;

-- Add new constraint with 'skipped' status
ALTER TABLE workflow_executions
ADD CONSTRAINT workflow_executions_status_check
CHECK (status = ANY (ARRAY[
    'queued'::text,
    'running'::text,
    'completed'::text,
    'failed'::text,
    'cancelled'::text,
    'timeout'::text,
    'skipped'::text
]));

COMMENT ON CONSTRAINT workflow_executions_status_check ON workflow_executions
IS 'Validates workflow execution status. Skipped status is used when a workflow runs but has no work to do (e.g., polling workflows with no changes).';

-- =============================================================================
-- 2. Update live_execution_status view to include 'skipped' status
-- =============================================================================

CREATE OR REPLACE VIEW live_execution_status AS
SELECT
    we.id,
    we.workflow_id,
    we.status,
    we.progress_percentage,
    we.current_step_index,
    we.total_steps,
    we.current_step_description,
    we.step_start_time,
    we.estimated_completion_time,
    we.started_at,
    we.created_at,
    we.execution_duration_seconds,
    we.modal_call_id,
    we.client_id,
    dw.name AS workflow_name,
    dw.description AS workflow_description,
    CASE
        WHEN we.status = 'running'::text AND we.progress_percentage > 0
        THEN EXTRACT(epoch FROM now() - we.started_at) *
             (100 - we.progress_percentage)::numeric / we.progress_percentage::numeric
        ELSE NULL::numeric
    END AS estimated_seconds_remaining,
    CASE
        WHEN we.status = 'running'::text AND we.current_step_index > 0 AND we.started_at IS NOT NULL
        THEN we.current_step_index::numeric * 60.0 / EXTRACT(epoch FROM now() - we.started_at)
        ELSE NULL::numeric
    END AS steps_per_minute
FROM workflow_executions we
JOIN deployed_workflows dw ON we.workflow_id = dw.id
WHERE we.status = ANY (ARRAY[
    'running'::text,
    'queued'::text,
    'completed'::text,
    'failed'::text,
    'cancelled'::text,
    'skipped'::text
])
ORDER BY we.created_at DESC;

COMMENT ON VIEW live_execution_status IS 'Real-time view of workflow executions including skipped runs. Excludes only timeout and cancelled-before-running statuses.';

-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Summary of changes:
-- 1. Updated workflow_executions_status_check constraint to allow 'skipped'
-- 2. Updated live_execution_status view to include 'skipped' in filter
--
-- Background:
-- - The Modal executor already handles 'skipped' status correctly
-- - This migration unblocks workflows that complete with no work to do
-- - Skipped workflows are valid completions and should appear in monitoring views
--
-- Related Issue:
-- - Execution 14998 failed with: "new row violates check constraint"
-- - Root cause: Workflow returned skipped=true but constraint didn't allow it
