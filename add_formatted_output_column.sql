-- Add column to store human-friendly formatted output
ALTER TABLE workflow_executions 
ADD COLUMN IF NOT EXISTS formatted_output TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN workflow_executions.formatted_output IS 'Human-friendly formatted summary of execution results (e.g., insurance quotes summary with emojis and formatting)';

-- Index for searching formatted output (optional, useful for searching quotes)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_formatted_output_gin 
ON workflow_executions USING gin(to_tsvector('english', formatted_output));
