-- Migration: Consolidate workflow views into unified comprehensive view
-- Created: 2026-01-13
-- Description: Merges deployed_workflows_with_sequence and deployed_workflows_with_sequence_latest
--              into a single comprehensive view with all needed columns.
--
-- Problems solved:
-- 1. is_featured was missing from both views (causing star badge to not show)
-- 2. latest_version_number was only in _latest view (causing API query failures)
-- 3. Two views with inconsistent columns caused fragile code
--
-- Solution: Single unified view with LATERAL join for version info and all columns

-- Drop existing views (CASCADE handles dependencies)
DROP VIEW IF EXISTS deployed_workflows_with_sequence CASCADE;
DROP VIEW IF EXISTS deployed_workflows_with_sequence_latest CASCADE;

-- Create unified comprehensive view
CREATE VIEW deployed_workflows_with_sequence AS
SELECT
    -- Core fields
    dw.id,
    dw.name,
    dw.description,
    dw.version,
    dw.status,
    dw.category,

    -- Workflow type and hierarchy
    dw.workflow_type,
    dw.parent_workflow_id,
    dw.display_order,

    -- Organization and ownership
    dw.organization_id,
    dw.created_by,
    dw.is_public,
    dw.is_featured,  -- Featured/demo workflows that appear for all users

    -- Execution statistics
    dw.successful_runs,
    dw.failed_runs,
    dw.cancelled_runs,
    dw.total_executions,
    dw.estimated_duration_seconds,

    -- Cron scheduling
    dw.cron_expression,
    dw.cron_timezone,
    dw.cron_enabled,
    dw.cron_executor_type,
    dw.last_scheduled_execution,
    dw.next_scheduled_execution,
    dw.cron_max_concurrent,
    dw.cron_retry_on_failure,
    dw.cron_retry_count,

    -- Auto-pause tracking
    dw.cron_auto_paused,
    dw.auto_paused_at,
    dw.auto_pause_reason,
    dw.consecutive_failures,
    dw.last_failure_message,

    -- GitHub sync
    dw.github_folder,
    dw.github_ref,
    dw.github_path,
    dw.github_sha,
    dw.github_last_synced_at,
    dw.github_sync_status,

    -- TypeScript workflow support
    dw.typescript_metadata,

    -- Workflow sequences (current version from base table)
    dw.automation_sequence,
    dw.automation_sequence_yaml,

    -- Computed sequence format
    CASE
        WHEN dw.automation_sequence_yaml IS NOT NULL AND dw.automation_sequence_yaml != '' THEN 'yaml'
        WHEN dw.automation_sequence IS NOT NULL THEN 'json'
        ELSE NULL
    END AS sequence_format,

    -- Versioning info
    dw.current_version_id,
    dw.total_versions,
    dwv.version_number AS latest_version_number,
    dwv.id AS latest_version_id,

    -- Timestamps
    dw.created_at,
    dw.updated_at,
    dw.updated_at AS last_activity_at,
    COALESCE(dwv.updated_at, dw.updated_at) AS last_modified_at,

    -- Tags for filtering
    dw.tags,

    -- Step count (computed from sequence)
    dw.step_count,

    -- UUID for downloads
    dw.uuid

FROM deployed_workflows dw
LEFT JOIN LATERAL (
    SELECT id, version_number, updated_at
    FROM deployed_workflow_versions
    WHERE workflow_id = dw.id
    ORDER BY created_at DESC
    LIMIT 1
) dwv ON true
WHERE dw.status IN ('active', 'deployed');

-- Create alias view for backward compatibility with code using _latest
-- This is identical to the main view (both now have version info)
CREATE VIEW deployed_workflows_with_sequence_latest AS
SELECT * FROM deployed_workflows_with_sequence;

-- Grant permissions
GRANT SELECT ON deployed_workflows_with_sequence TO anon, authenticated, service_role;
GRANT SELECT ON deployed_workflows_with_sequence_latest TO anon, authenticated, service_role;

-- Add documentation
COMMENT ON VIEW deployed_workflows_with_sequence IS
'Unified view of deployed workflows with all metadata, cron config, versioning, and featured status.
Includes LATERAL join to get latest version info. Filters to active/deployed workflows only.
Replaces the previous split between base view and _latest view.';

COMMENT ON VIEW deployed_workflows_with_sequence_latest IS
'Backward-compatible alias for deployed_workflows_with_sequence.
Both views are now identical - use deployed_workflows_with_sequence for new code.';
