-- Migration: Add OpenTelemetry trace_id to workflow_executions
-- Created: 2025-11-24
-- Description: Adds trace_id column for reliable log correlation with ClickHouse

-- Add trace_id column
ALTER TABLE workflow_executions
ADD COLUMN IF NOT EXISTS trace_id TEXT;

-- Add index for fast trace_id lookups
CREATE INDEX IF NOT EXISTS idx_workflow_executions_trace_id
ON workflow_executions(trace_id)
WHERE trace_id IS NOT NULL;

-- Add comment
COMMENT ON COLUMN workflow_executions.trace_id IS 'OpenTelemetry trace ID for correlating logs in ClickHouse. Set by rust-executor when execution starts.';
