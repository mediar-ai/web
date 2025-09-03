-- Migration: Add cron scheduling support to deployed_workflows
-- Created: 2025-01-28
-- Description: Adds cron scheduling capabilities to workflows with timezone support

-- Add cron scheduling columns to deployed_workflows table
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS cron_expression TEXT,
ADD COLUMN IF NOT EXISTS cron_timezone TEXT DEFAULT 'UTC',
ADD COLUMN IF NOT EXISTS cron_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_scheduled_execution TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS next_scheduled_execution TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS cron_max_concurrent INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS cron_retry_on_failure BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS cron_retry_count INTEGER DEFAULT 3;

-- Create index for efficient cron job queries
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_cron_scheduled 
ON public.deployed_workflows(cron_enabled, next_scheduled_execution) 
WHERE cron_enabled = TRUE;

-- Create index for cron expression lookups
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_cron_expression 
ON public.deployed_workflows(cron_expression) 
WHERE cron_enabled = TRUE;
-- Add comments for documentation
COMMENT ON COLUMN public.deployed_workflows.cron_expression IS 'Cron expression in 6-field format: SECOND MINUTE HOUR DAY MONTH DAY_OF_WEEK';
COMMENT ON COLUMN public.deployed_workflows.cron_timezone IS 'Timezone for cron execution (IANA timezone format)';
COMMENT ON COLUMN public.deployed_workflows.cron_enabled IS 'Whether cron scheduling is enabled for this workflow';
COMMENT ON COLUMN public.deployed_workflows.last_scheduled_execution IS 'Timestamp of last cron-triggered execution';
COMMENT ON COLUMN public.deployed_workflows.next_scheduled_execution IS 'Calculated timestamp for next cron execution';
COMMENT ON COLUMN public.deployed_workflows.cron_max_concurrent IS 'Maximum concurrent executions allowed for this cron job';
COMMENT ON COLUMN public.deployed_workflows.cron_retry_on_failure IS 'Whether to retry failed cron executions';
COMMENT ON COLUMN public.deployed_workflows.cron_retry_count IS 'Number of retry attempts for failed cron executions';

-- Create a view for active cron jobs
CREATE OR REPLACE VIEW public.active_cron_jobs AS
SELECT 
    id,
    name,
    description,
    version,
    cron_expression,
    cron_timezone,
    last_scheduled_execution,
    next_scheduled_execution,
    cron_max_concurrent,
    cron_retry_on_failure,
    cron_retry_count,
    created_at,
    updated_at
FROM public.deployed_workflows
WHERE cron_enabled = TRUE 
AND status = 'active'
ORDER BY next_scheduled_execution ASC;

-- Grant permissions
GRANT SELECT ON public.active_cron_jobs TO authenticated;
GRANT SELECT ON public.active_cron_jobs TO service_role;
