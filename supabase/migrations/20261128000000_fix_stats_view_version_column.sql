-- Migration: Fix workflow_statistics_summary view to use correct version column
-- Created: 2025-11-28
-- Description: Use COALESCE(workflow_version_number, version_number) to handle
--              executions where only version_number is populated (Rust executor)

-- =============================================================================
-- Update the workflow_statistics_summary view
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
    -- Use COALESCE to handle both workflow_version_number and version_number columns
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
    -- Activity timestamps
    GREATEST(w.updated_at, w.last_successful_execution, w.last_failed_execution) as last_activity_at,
    w.updated_at as last_modified_at
FROM deployed_workflows w
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
    -- FIX: Use COALESCE to check both version columns
    AND COALESCE(we.workflow_version_number, we.version_number) = w.version
) cv ON true;

-- =============================================================================
-- Also update the _latest view used by desktop app
-- =============================================================================

CREATE OR REPLACE VIEW workflow_statistics_summary_latest AS
SELECT
    w.id,
    w.name,
    w.description,
    lv.version_number as current_version,
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
    -- Current version statistics (for LATEST version by created_at)
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
    -- Activity timestamps
    GREATEST(w.updated_at, w.last_successful_execution, w.last_failed_execution) as last_activity_at,
    COALESCE(lv.updated_at, w.updated_at) as last_modified_at
FROM deployed_workflows w
-- Get latest version by created_at
LEFT JOIN LATERAL (
    SELECT wv.version_number, wv.updated_at
    FROM workflow_versions wv
    WHERE wv.workflow_id = w.id
    ORDER BY wv.created_at DESC
    LIMIT 1
) lv ON true
-- Calculate stats for latest version
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
    -- FIX: Use COALESCE to check both version columns
    AND COALESCE(we.workflow_version_number, we.version_number) = COALESCE(lv.version_number, w.version)
) cv ON true;

COMMENT ON VIEW workflow_statistics_summary IS
'Workflow statistics view - uses COALESCE to handle both workflow_version_number and version_number columns';
