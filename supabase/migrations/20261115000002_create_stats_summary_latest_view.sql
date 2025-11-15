-- Migration: Create workflow_statistics_summary_latest view for desktop app
-- Created: 2026-11-15
-- Description: Desktop app needs statistics from LATEST version (not active version)
--              to show correct timestamps when editing workflows

CREATE OR REPLACE VIEW workflow_statistics_summary_latest AS
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
    -- Current version statistics (calculated for latest version, not active)
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
    w.updated_at as last_activity_at,                      -- When workflow stats were last updated
    COALESCE(v.updated_at, w.updated_at) as last_modified_at  -- When LATEST version was created/modified
FROM deployed_workflows w
LEFT JOIN LATERAL (
    -- Get the LATEST version (by created_at DESC) instead of current_version_id
    SELECT id, version_number, updated_at
    FROM deployed_workflow_versions
    WHERE workflow_id = w.id
    ORDER BY created_at DESC
    LIMIT 1
) v ON true
LEFT JOIN LATERAL (
    -- Get statistics for the latest version
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
    AND we.workflow_version_number = v.version_number  -- Stats for latest version
) cv ON true;

-- Grant permissions
GRANT SELECT ON workflow_statistics_summary_latest TO anon, authenticated, service_role;

-- Add comments
COMMENT ON VIEW workflow_statistics_summary_latest IS
'Statistics view for desktop app showing LATEST version (by created_at) instead of active version.
- updated_at: Workflow metadata last updated (backward compatible)
- last_activity_at: When workflow was last active (execution completed, stats updated)
- last_modified_at: When LATEST version was created/modified (from latest version updated_at)';
