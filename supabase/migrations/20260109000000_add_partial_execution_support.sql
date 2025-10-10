-- Migration: Add partial execution support to workflow_executions
-- Created: 2026-01-09
-- Description: Enables running specific steps of workflows for debugging/partial execution

-- Add execution control columns
ALTER TABLE public.workflow_executions
ADD COLUMN IF NOT EXISTS start_from_step text,
ADD COLUMN IF NOT EXISTS end_at_step text,
ADD COLUMN IF NOT EXISTS follow_fallback boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS execute_jumps_at_end boolean DEFAULT false;

-- Add indexes for querying partial executions
CREATE INDEX IF NOT EXISTS idx_workflow_executions_partial
ON public.workflow_executions(start_from_step, end_at_step)
WHERE start_from_step IS NOT NULL OR end_at_step IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.workflow_executions.start_from_step
IS 'Step ID to start execution from (for partial/resume execution)';

COMMENT ON COLUMN public.workflow_executions.end_at_step
IS 'Step ID to stop execution at (inclusive, for partial/debug execution)';

COMMENT ON COLUMN public.workflow_executions.follow_fallback
IS 'Whether to follow fallback_id when end_at_step is specified (default: false for bounded execution)';

COMMENT ON COLUMN public.workflow_executions.execute_jumps_at_end
IS 'Whether to execute jump conditions at end_at_step boundary (default: false, set true for loops)';
