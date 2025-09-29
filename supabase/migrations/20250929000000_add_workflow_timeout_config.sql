-- Migration: Add workflow timeout configuration
-- Created: 2025-09-29
-- Description: Adds timeout configuration to workflows to prevent stuck executions

-- Add timeout_minutes column to deployed_workflows
ALTER TABLE public.deployed_workflows
ADD COLUMN IF NOT EXISTS timeout_minutes integer DEFAULT 25
CHECK (timeout_minutes > 0 AND timeout_minutes <= 120);

-- Add comment for documentation
COMMENT ON COLUMN public.deployed_workflows.timeout_minutes IS 'Maximum execution time in minutes before workflow is terminated (default 25, max 120)';

-- Add timeout_minutes to workflow_versions as well
ALTER TABLE public.workflow_versions
ADD COLUMN IF NOT EXISTS timeout_minutes integer DEFAULT 25
CHECK (timeout_minutes > 0 AND timeout_minutes <= 120);

COMMENT ON COLUMN public.workflow_versions.timeout_minutes IS 'Maximum execution time in minutes before workflow is terminated (default 25, max 120)';

-- Update the deployed_workflows_with_sequence view to include timeout configuration
CREATE OR REPLACE VIEW deployed_workflows_with_sequence AS
SELECT
    dw.id,
    dw.name,
    dw.description,
    dw.version,
    dw.status,
    dw.automation_sequence,
    dw.automation_sequence_yaml,
    dw.validation_checks,
    dw.error_handling,
    dw.input_parameters,
    dw.expected_outputs,
    dw.sample_inputs,
    dw.estimated_duration_seconds,
    dw.timeout_minutes,  -- Include timeout configuration
    dw.category,
    dw.successful_runs,
    dw.failed_runs,
    dw.cancelled_runs,
    dw.total_executions,
    dw.last_successful_execution,
    dw.last_failed_execution,
    dw.created_by,
    dw.created_at,
    dw.updated_at,
    dw.modal_function_name,
    dw.deployment_status,
    dw.last_deployed_at,
    dw.active_version,
    dw.workflow_type,
    dw.parent_workflow_id,
    dw.cron_schedule,
    dw.cron_enabled,
    dw.last_cron_run,
    dw.next_cron_run,
    dw.requires_files,
    dw.files_config,
    dw.skip_cancellation_check,
    dw.organization_id,
    -- Add organization info
    o.name as organization_name
FROM public.deployed_workflows dw
LEFT JOIN public.organizations o ON dw.organization_id = o.id
WHERE dw.status = 'active';

-- Grant permissions on the view
GRANT SELECT ON deployed_workflows_with_sequence TO authenticated;
GRANT SELECT ON deployed_workflows_with_sequence TO anon;