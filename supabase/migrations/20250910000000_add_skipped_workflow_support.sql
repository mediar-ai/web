-- Migration: Add support for skipped workflow state
-- Description: Adds skipped_runs column and updates triggers to handle skipped workflows
-- Date: 2025-09-10

-- =============================================================================
-- 1. Add skipped status to workflow_executions status enum
-- =============================================================================

-- First, check if 'skipped' is already in the enum
DO $$ 
BEGIN
    -- Add 'skipped' to the status enum if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum 
        WHERE enumlabel = 'skipped' 
        AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'workflow_execution_status'
        )
    ) THEN
        -- Note: We need to handle this carefully as ALTER TYPE ... ADD VALUE cannot be run in a transaction
        ALTER TYPE workflow_execution_status ADD VALUE IF NOT EXISTS 'skipped' AFTER 'cancelled';
    END IF;
END $$;

-- =============================================================================
-- 2. Add skipped_runs column to deployed_workflows table
-- =============================================================================

ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS skipped_runs INTEGER DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN public.deployed_workflows.skipped_runs IS 'Number of times this workflow was skipped (e.g., polling with no changes)';

-- =============================================================================
-- 3. Update the workflow stats trigger to handle skipped status
-- =============================================================================

CREATE OR REPLACE FUNCTION update_workflow_stats()
RETURNS TRIGGER AS $$
DECLARE
    new_avg_duration INT;
BEGIN
    -- Only update stats when status changes to completed, failed, or skipped
    IF NEW.status IN ('completed', 'failed', 'skipped') AND OLD.status NOT IN ('completed', 'failed', 'skipped') THEN
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
            
        ELSIF NEW.status = 'skipped' THEN
            -- Skipped workflows don't count toward success/failure metrics
            -- They are tracked separately and don't affect success rate
            UPDATE public.deployed_workflows 
            SET 
                skipped_runs = skipped_runs + 1,
                -- Note: We do NOT increment total_executions for skipped runs
                -- This ensures success rate calculations are not affected
                updated_at = now()
            WHERE id = NEW.workflow_id;
            
            -- Log the skip for monitoring
            RAISE NOTICE 'Workflow % was skipped: %', NEW.workflow_id, NEW.error_message;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- No need to recreate the trigger as it already exists and will use the updated function

-- =============================================================================
-- 4. Create a view for workflow statistics that properly handles skipped runs
-- =============================================================================

CREATE OR REPLACE VIEW workflow_statistics AS
SELECT 
    id,
    name,
    status,
    successful_runs,
    failed_runs,
    cancelled_runs,
    skipped_runs,
    total_executions,
    -- Success rate calculation excludes skipped runs
    CASE 
        WHEN total_executions > 0 THEN 
            ROUND((successful_runs::NUMERIC / total_executions) * 100, 2)
        ELSE 0
    END AS success_rate,
    -- Actual run count (includes skipped)
    (successful_runs + failed_runs + cancelled_runs + skipped_runs) AS total_runs_including_skipped,
    -- Skip rate for monitoring
    CASE 
        WHEN (successful_runs + failed_runs + cancelled_runs + skipped_runs) > 0 THEN 
            ROUND((skipped_runs::NUMERIC / (successful_runs + failed_runs + cancelled_runs + skipped_runs)) * 100, 2)
        ELSE 0
    END AS skip_rate,
    created_at,
    updated_at
FROM public.deployed_workflows;

COMMENT ON VIEW workflow_statistics IS 'View providing comprehensive workflow statistics including skip rates';

-- =============================================================================
-- 5. Update existing workflows to initialize skipped_runs to 0
-- =============================================================================

UPDATE public.deployed_workflows 
SET skipped_runs = 0 
WHERE skipped_runs IS NULL;

-- =============================================================================
-- 6. Add index for performance on workflow executions with skipped status
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_workflow_executions_skipped 
ON public.workflow_executions(workflow_id, status) 
WHERE status = 'skipped';

-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Summary of changes:
-- 1. Added 'skipped' status to workflow_execution_status enum
-- 2. Added skipped_runs column to deployed_workflows table  
-- 3. Updated workflow stats trigger to handle skipped workflows separately
-- 4. Created workflow_statistics view with proper success rate calculation
-- 5. Added index for efficient querying of skipped workflows

-- Important notes:
-- - Skipped workflows do NOT count toward total_executions
-- - Success rate = successful_runs / total_executions (excludes skipped)
-- - Skip rate is tracked separately for monitoring purposes
-- - This ensures billing/charging is fair - customers are not charged for skipped workflows