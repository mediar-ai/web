-- Add columns to store raw logs and raw MCP response
ALTER TABLE workflow_executions 
ADD COLUMN IF NOT EXISTS raw_logs TEXT,
ADD COLUMN IF NOT EXISTS raw_mcp_response JSONB,
ADD COLUMN IF NOT EXISTS execution_logs JSONB DEFAULT '[]'::jsonb;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_workflow_executions_raw_mcp_response ON workflow_executions USING GIN (raw_mcp_response);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_execution_logs ON workflow_executions USING GIN (execution_logs);

-- Add comment explaining the columns
COMMENT ON COLUMN workflow_executions.raw_logs IS 'Raw text logs from Modal execution';
COMMENT ON COLUMN workflow_executions.raw_mcp_response IS 'Complete raw response from MCP browser automation';
COMMENT ON COLUMN workflow_executions.execution_logs IS 'Structured logs array with timestamps and levels';
