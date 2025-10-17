-- Migration: Add executor_type column to workflow_executions
-- Created: 2025-10-17
-- Description: Adds executor_type column to support routing jobs to Python or Rust executors

-- Add executor_type column
ALTER TABLE public.workflow_executions
ADD COLUMN IF NOT EXISTS executor_type text
CHECK (executor_type IS NULL OR executor_type IN ('python', 'rust'));

-- Add index for efficient executor filtering
CREATE INDEX IF NOT EXISTS idx_workflow_executions_executor_type
ON public.workflow_executions(executor_type);

-- Add comment for documentation
COMMENT ON COLUMN public.workflow_executions.executor_type IS
'Executor type for job routing: python (Modal), rust (Azure), or NULL (legacy/default to python)';
