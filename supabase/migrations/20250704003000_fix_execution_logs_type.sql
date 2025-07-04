ALTER TABLE workflow_executions
ALTER COLUMN execution_logs TYPE jsonb USING execution_logs::jsonb; 