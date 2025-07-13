-- Fix: Remove cancelled jobs from total_executions count
-- Cancelled jobs should not count as "executions" since they never actually executed

-- Update the trigger function to exclude cancelled jobs from total_executions
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
            -- Cancelled jobs do NOT count as executions - they never actually executed
            UPDATE public.deployed_workflows 
            SET 
                cancelled_runs = cancelled_runs + 1,
                -- Note: total_executions is NOT incremented for cancelled jobs
                updated_at = now()
            WHERE id = NEW.workflow_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Fix existing data: Recalculate total_executions to exclude cancelled jobs
UPDATE public.deployed_workflows 
SET total_executions = (
    SELECT COUNT(*) 
    FROM public.workflow_executions 
    WHERE workflow_id = deployed_workflows.id 
    AND status IN ('completed', 'failed')
)
WHERE id IN (
    SELECT DISTINCT workflow_id 
    FROM public.workflow_executions 
    WHERE status = 'cancelled'
);

-- Add comment explaining the fix
COMMENT ON FUNCTION update_workflow_stats() IS 'Updated to exclude cancelled jobs from total_executions count. Cancelled jobs are tracked separately but do not count as actual executions since they never ran.'; 