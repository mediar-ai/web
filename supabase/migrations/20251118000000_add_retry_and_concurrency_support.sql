-- Migration: Add retry mechanism and concurrency support
-- Created: 2025-11-18
-- Description: Adds retry tracking columns and updates queue claiming logic for concurrent execution

-- =============================================================================
-- Add Retry Columns to workflow_executions
-- =============================================================================

ALTER TABLE public.workflow_executions
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0 CHECK (retry_count >= 0),
ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 0 CHECK (max_retries >= 0),
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS is_retryable BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS error_category VARCHAR(50) NULL CHECK (error_category IN ('infrastructure', 'workflow_logic', 'unknown'));

-- =============================================================================
-- Indexes for Performance
-- =============================================================================

-- Index for claiming retryable executions
CREATE INDEX IF NOT EXISTS idx_workflow_executions_retryable
ON public.workflow_executions(next_retry_at, retry_count)
WHERE is_retryable = TRUE AND status = 'failed';

-- Index for queue claiming (includes retries)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_queue_claim
ON public.workflow_executions(status, priority, queued_at)
WHERE status IN ('queued', 'failed');

-- =============================================================================
-- Comments for Documentation
-- =============================================================================

COMMENT ON COLUMN public.workflow_executions.retry_count IS
  'Number of times this execution has been retried (for infrastructure failures only)';

COMMENT ON COLUMN public.workflow_executions.max_retries IS
  'Maximum number of retries allowed for this execution (configured by executor)';

COMMENT ON COLUMN public.workflow_executions.next_retry_at IS
  'When this execution should be retried (NULL if not retryable)';

COMMENT ON COLUMN public.workflow_executions.is_retryable IS
  'Whether this execution is eligible for retry (TRUE for infrastructure failures)';

COMMENT ON COLUMN public.workflow_executions.error_category IS
  'Category of error: infrastructure (retry), workflow_logic (no retry), or unknown (no retry)';

-- =============================================================================
-- Update existing failed executions
-- =============================================================================

-- Mark existing failed executions as non-retryable to avoid unexpected retries
UPDATE public.workflow_executions
SET
  is_retryable = FALSE,
  error_category = 'unknown',
  retry_count = 0,
  max_retries = 0
WHERE status = 'failed' AND is_retryable IS NULL;
