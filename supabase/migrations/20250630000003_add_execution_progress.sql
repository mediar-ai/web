-- Add progress tracking columns to workflow_executions table
ALTER TABLE workflow_executions 
ADD COLUMN IF NOT EXISTS progress_percentage INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_step_index INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_steps INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_step_description TEXT,
ADD COLUMN IF NOT EXISTS step_start_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS estimated_completion_time TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS progress_details JSONB DEFAULT '{}';

-- Add constraints (PostgreSQL doesn't support IF NOT EXISTS for constraints)
-- Check if constraints exist before adding them
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_progress_percentage') THEN
        ALTER TABLE workflow_executions 
        ADD CONSTRAINT chk_progress_percentage 
        CHECK (progress_percentage >= 0 AND progress_percentage <= 100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_current_step_index') THEN
        ALTER TABLE workflow_executions 
        ADD CONSTRAINT chk_current_step_index 
        CHECK (current_step_index >= 0);
    END IF;
END$$;

-- Add index for efficient querying of running executions
CREATE INDEX IF NOT EXISTS idx_workflow_executions_running_status 
ON workflow_executions(status, progress_percentage) 
WHERE status IN ('running', 'queued');

-- Create a view for live execution monitoring
CREATE OR REPLACE VIEW live_execution_status AS
SELECT 
  we.id,
  we.workflow_id,
  we.status,
  we.progress_percentage,
  we.current_step_index,
  we.total_steps,
  we.current_step_description,
  we.step_start_time,
  we.estimated_completion_time,
  we.started_at,
  we.created_at,
  we.execution_duration_seconds,
  we.modal_call_id,
  we.client_id,
  dw.name as workflow_name,
  dw.description as workflow_description,
  -- Calculate estimated time remaining
  CASE 
    WHEN we.status = 'running' AND we.progress_percentage > 0 
    THEN EXTRACT(EPOCH FROM (NOW() - we.started_at)) * (100 - we.progress_percentage) / we.progress_percentage
    ELSE NULL
  END as estimated_seconds_remaining,
  -- Calculate steps per minute
  CASE 
    WHEN we.status = 'running' AND we.current_step_index > 0 AND we.started_at IS NOT NULL
    THEN (we.current_step_index * 60.0) / EXTRACT(EPOCH FROM (NOW() - we.started_at))
    ELSE NULL
  END as steps_per_minute
FROM workflow_executions we
JOIN deployed_workflows dw ON we.workflow_id = dw.id
WHERE we.status IN ('running', 'queued', 'completed', 'failed')
ORDER BY we.created_at DESC;

-- Function to update execution progress
CREATE OR REPLACE FUNCTION update_execution_progress(
  p_execution_id INTEGER,
  p_progress_percentage INTEGER,
  p_current_step_index INTEGER DEFAULT NULL,
  p_current_step_description TEXT DEFAULT NULL,
  p_progress_details JSONB DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE workflow_executions 
  SET 
    progress_percentage = p_progress_percentage,
    current_step_index = COALESCE(p_current_step_index, current_step_index),
    current_step_description = COALESCE(p_current_step_description, current_step_description),
    progress_details = COALESCE(p_progress_details, progress_details),
    step_start_time = CASE 
      WHEN p_current_step_description IS NOT NULL AND p_current_step_description != current_step_description 
      THEN NOW() 
      ELSE step_start_time 
    END,
    updated_at = NOW()
  WHERE id = p_execution_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;
