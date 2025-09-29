-- Add error analysis columns to workflow_executions table
ALTER TABLE workflow_executions
ADD COLUMN IF NOT EXISTS error_analysis TEXT,
ADD COLUMN IF NOT EXISTS error_analyzed_at TIMESTAMP WITH TIME ZONE;

-- Add index for faster queries on failed executions with analysis
CREATE INDEX IF NOT EXISTS idx_workflow_executions_error_analysis
ON workflow_executions(status, error_analyzed_at)
WHERE status = 'failed' AND error_analysis IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN workflow_executions.error_analysis IS 'AI-generated analysis of execution errors for debugging';
COMMENT ON COLUMN workflow_executions.error_analyzed_at IS 'Timestamp when error analysis was generated';