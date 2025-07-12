-- Add cancelled_runs field to deployed_workflows table
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS cancelled_runs integer DEFAULT 0;

-- Update the trigger function to handle cancelled status
CREATE OR REPLACE FUNCTION update_workflow_stats()
RETURNS TRIGGER AS $$
DECLARE
    new_avg_duration INT;
BEGIN
    -- Only update stats when status changes to completed, failed, or cancelled
    IF NEW.status IN ('completed', 'failed', 'cancelled') AND OLD.status NOT IN ('completed', 'failed', 'cancelled') THEN
        IF NEW.status = 'completed' THEN
            -- Calculate the new average duration from all successful runs for this workflow
            SELECT AVG(execution_duration_seconds)::INT INTO new_avg_duration
            FROM public.workflow_executions
            WHERE workflow_id = NEW.workflow_id AND status = 'completed';

            -- Update the parent workflow with the new stats
            UPDATE public.deployed_workflows 
            SET 
                successful_runs = successful_runs + 1,
                total_executions = total_executions + 1,
                last_successful_execution = NEW.completed_at,
                estimated_duration_seconds = new_avg_duration,
                updated_at = now()
            WHERE id = NEW.workflow_id;
        ELSIF NEW.status = 'failed' THEN
            UPDATE public.deployed_workflows 
            SET 
                failed_runs = failed_runs + 1,
                total_executions = total_executions + 1,
                last_failed_execution = NEW.completed_at,
                updated_at = now()
            WHERE id = NEW.workflow_id;
        ELSIF NEW.status = 'cancelled' THEN
            UPDATE public.deployed_workflows 
            SET 
                cancelled_runs = cancelled_runs + 1,
                total_executions = total_executions + 1,
                updated_at = now()
            WHERE id = NEW.workflow_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add comment explaining the new field
COMMENT ON COLUMN public.deployed_workflows.cancelled_runs IS 'Count of cancelled workflow executions (cancelled due to system issues, not workflow failures)'; 