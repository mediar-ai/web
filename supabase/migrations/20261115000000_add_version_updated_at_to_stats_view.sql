-- Migration: Add version updated_at to workflow statistics view
-- Created: 2026-11-15
-- Description: Separates "last activity" (execution time) from "last modified" (definition change time)
--              to fix issue where frequently-run workflows always appear "freshly modified"

-- =============================================================================
-- Update workflow_statistics_summary view to include version's updated_at
-- =============================================================================

CREATE OR REPLACE VIEW workflow_statistics_summary AS
SELECT
    w.id,
    w.name,
    w.description,
    w.version as current_version,
    w.status,
    w.category,
    w.estimated_duration_seconds,
    -- Overall statistics
    w.total_executions as overall_total_executions,
    w.successful_runs as overall_successful_runs,
    w.failed_runs as overall_failed_runs,
    w.cancelled_runs as overall_cancelled_runs,
    CASE
        WHEN w.total_executions > 0 THEN
            ROUND((w.successful_runs::numeric / w.total_executions::numeric) * 100, 1)
        ELSE 0
    END as overall_success_rate,
    -- Current version statistics (calculated from executions)
    COALESCE(cv.total_executions, 0) as current_version_total_executions,
    COALESCE(cv.successful_runs, 0) as current_version_successful_runs,
    COALESCE(cv.failed_runs, 0) as current_version_failed_runs,
    COALESCE(cv.cancelled_runs, 0) as current_version_cancelled_runs,
    COALESCE(cv.success_rate, 0) as current_version_success_rate,
    COALESCE(cv.average_duration_seconds, w.estimated_duration_seconds) as current_version_avg_duration,
    -- Metadata
    w.total_versions,
    w.current_version_id,
    w.created_at,
    w.updated_at,
    w.updated_at as last_activity_at,     -- When workflow metadata was last updated (includes executions)
    COALESCE(v.updated_at, w.updated_at) as last_modified_at  -- When workflow definition was last modified
FROM deployed_workflows w
LEFT JOIN deployed_workflow_versions v ON w.current_version_id = v.id
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) as total_executions,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_runs,
        CASE
            WHEN COUNT(*) > 0 THEN
                ROUND((COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*)::numeric) * 100, 1)
            ELSE 0
        END as success_rate,
        ROUND(AVG(execution_duration_seconds) FILTER (WHERE status = 'completed'), 1) as average_duration_seconds
    FROM workflow_executions we
    WHERE we.workflow_id = w.id
    AND we.workflow_version_number = w.version
) cv ON true;

-- =============================================================================
-- Add comments for documentation
-- =============================================================================

COMMENT ON VIEW workflow_statistics_summary IS
'Workflow statistics with separated timestamps:
- updated_at: Workflow metadata last updated (backward compatible)
- last_activity_at: When workflow stats were last updated (execution completion)
- last_modified_at: When workflow definition was last modified (from active version)';

COMMENT ON COLUMN workflow_statistics_summary.updated_at IS
'Backward compatible: workflow metadata last updated time (includes execution stats)';

COMMENT ON COLUMN workflow_statistics_summary.last_activity_at IS
'When workflow was last active (execution completed, stats updated, etc)';

COMMENT ON COLUMN workflow_statistics_summary.last_modified_at IS
'When workflow definition was last modified (from active version updated_at)';
