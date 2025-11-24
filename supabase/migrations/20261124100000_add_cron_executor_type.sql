-- Migration: Add cron_executor_type to deployed_workflows
-- Description: Allows selecting which executor (python/rust) runs scheduled workflows

-- Add cron_executor_type column
ALTER TABLE public.deployed_workflows
ADD COLUMN IF NOT EXISTS cron_executor_type text
DEFAULT 'python'
CHECK (cron_executor_type IN ('python', 'rust'));

-- Create index for executor type filtering
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_cron_executor_type
ON public.deployed_workflows(cron_executor_type)
WHERE cron_enabled = TRUE;

-- Add comment
COMMENT ON COLUMN public.deployed_workflows.cron_executor_type IS
'Executor type for scheduled cron runs: python (legacy Modal) or rust (Azure ACI). Defaults to python.';
