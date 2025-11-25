-- Migration: Add cron_executor_type to deployed_workflows_with_sequence view
-- Date: 2025-11-24
-- Issue: cron_executor_type column was added to deployed_workflows table but not to the view
-- Result: Cron scheduler always defaulted to 'python' executor because the column was null in queries
-- Impact: Workflows with cron_executor_type='rust' were incorrectly running on Python executor

-- Must drop and recreate since we're changing columns
DROP VIEW IF EXISTS deployed_workflows_with_sequence CASCADE;

-- Recreate view with cron_executor_type included
CREATE VIEW deployed_workflows_with_sequence AS
SELECT
    dw.id,
    dw.name,
    dw.description,
    dw.version,
    dw.status,
    dw.automation_sequence,
    dw.automation_sequence_yaml,
    dw.category,
    dw.created_by,
    dw.created_at,
    dw.updated_at,
    dw.github_folder,
    dw.github_ref,
    dw.github_path,
    dw.workflow_type,
    dw.parent_workflow_id,
    dw.display_order,
    dw.cron_expression,
    dw.cron_timezone,
    dw.cron_enabled,
    dw.last_scheduled_execution,
    dw.next_scheduled_execution,
    dw.cron_max_concurrent,
    dw.cron_retry_on_failure,
    dw.cron_retry_count,
    dw.cron_auto_paused,
    dw.consecutive_failures,
    dw.last_failure_message,
    dw.auto_paused_at,
    dw.auto_pause_reason,
    dw.organization_id,
    dw.typescript_metadata,
    dw.cron_executor_type,
    -- Computed column for sequence format (yaml/json)
    CASE
        WHEN dw.automation_sequence_yaml IS NOT NULL AND dw.automation_sequence_yaml != '' THEN 'yaml'
        WHEN dw.automation_sequence IS NOT NULL THEN 'json'
        ELSE NULL
    END AS sequence_format
FROM deployed_workflows dw
WHERE dw.status IN ('active', 'deployed');

-- Add comment
COMMENT ON VIEW deployed_workflows_with_sequence IS
'View of deployed workflows with sequence data. Includes cron configuration and executor type settings.';
