-- Migration: Add timestamp fields to deployed_workflows_with_sequence_latest view
-- Created: 2026-11-15
-- Description: Adds last_activity_at and last_modified_at to the desktop app's LATEST view
--              to match the workflow_statistics_summary view changes

-- Drop and recreate the view with timestamp fields
DROP VIEW IF EXISTS deployed_workflows_with_sequence_latest CASCADE;

CREATE VIEW deployed_workflows_with_sequence_latest AS
SELECT
    dw.id,
    dw.name,
    dw.description,
    dw.version,
    dw.status,
    dw.category,
    dw.workflow_type,
    dw.parent_workflow_id,
    dw.display_order,
    dw.organization_id,
    dw.created_by,
    dw.is_public,
    dw.estimated_duration_seconds,
    dw.successful_runs,
    dw.failed_runs,
    dw.cancelled_runs,
    dw.total_executions,
    dw.cron_expression,
    dw.cron_timezone,
    dw.cron_enabled,
    dw.last_scheduled_execution,
    dw.next_scheduled_execution,
    dw.cron_max_concurrent,
    dw.cron_retry_on_failure,
    dw.cron_retry_count,
    dw.cron_auto_paused,
    dw.auto_paused_at,
    dw.auto_pause_reason,
    dw.consecutive_failures,
    dw.last_failure_message,
    dw.created_at,
    dw.updated_at,
    dw.updated_at as last_activity_at,                      -- When workflow was last active (execution, stats update)
    COALESCE(dwv.updated_at, dw.updated_at) as last_modified_at,  -- When workflow definition was last modified
    dw.github_path,
    dw.github_ref,
    dw.github_sha,
    dw.github_folder,
    dw.github_last_synced_at,
    dw.github_sync_status,
    dw.current_version_id,
    dw.total_versions,
    dwv.automation_sequence,
    dwv.version_number AS latest_version_number,
    dwv.id AS latest_version_id
FROM deployed_workflows dw
LEFT JOIN LATERAL (
    SELECT id, version_number, automation_sequence, updated_at
    FROM deployed_workflow_versions
    WHERE workflow_id = dw.id
    ORDER BY created_at DESC
    LIMIT 1
) dwv ON true;

-- Grant permissions
GRANT SELECT ON deployed_workflows_with_sequence_latest TO anon, authenticated, service_role;

-- Add comments
COMMENT ON VIEW deployed_workflows_with_sequence_latest IS
'Desktop app view showing latest version (by created_at) with timestamp fields:
- updated_at: Workflow metadata last updated (backward compatible)
- last_activity_at: When workflow was last active (execution completed)
- last_modified_at: When workflow definition was last modified (from latest version)';
