-- Migration: Add cron failure tracking to deployed_workflows
-- Created: 2026-01-18
-- Description: Track consecutive failures and auto-pause cron jobs after 3 identical failures

-- Add failure tracking columns
ALTER TABLE public.deployed_workflows
ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_failure_message TEXT,
ADD COLUMN IF NOT EXISTS cron_auto_paused BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS auto_paused_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS auto_pause_reason TEXT;

-- Create index for finding auto-paused workflows
CREATE INDEX IF NOT EXISTS idx_workflows_auto_paused
ON public.deployed_workflows(cron_auto_paused)
WHERE cron_auto_paused = TRUE;

-- Create index for cron-enabled workflows with failure tracking
CREATE INDEX IF NOT EXISTS idx_workflows_cron_failures
ON public.deployed_workflows(cron_enabled, consecutive_failures)
WHERE cron_enabled = TRUE AND consecutive_failures > 0;

-- Add comments for documentation
COMMENT ON COLUMN public.deployed_workflows.consecutive_failures IS 'Number of consecutive failures with the same error message';
COMMENT ON COLUMN public.deployed_workflows.last_failure_message IS 'Message from the last failed execution (from formatted_output.message)';
COMMENT ON COLUMN public.deployed_workflows.cron_auto_paused IS 'Whether cron was automatically paused due to repeated failures';
COMMENT ON COLUMN public.deployed_workflows.auto_paused_at IS 'Timestamp when cron was automatically paused';
COMMENT ON COLUMN public.deployed_workflows.auto_pause_reason IS 'Reason for auto-pausing (includes failure message)';

-- Create function to check for consecutive failures and auto-pause
CREATE OR REPLACE FUNCTION check_cron_consecutive_failures()
RETURNS TRIGGER AS $$
DECLARE
    workflow_record RECORD;
    failure_message TEXT;
    new_consecutive_failures INTEGER;
BEGIN
    -- Only check for cron-enabled workflows when execution completes
    IF NEW.status NOT IN ('completed', 'failed') OR OLD.status IN ('completed', 'failed') THEN
        RETURN NEW;
    END IF;

    -- Get workflow details
    SELECT id, name, cron_enabled, consecutive_failures, last_failure_message, cron_auto_paused
    INTO workflow_record
    FROM deployed_workflows
    WHERE id = NEW.workflow_id;

    -- Only process cron-enabled workflows that aren't already auto-paused
    IF NOT workflow_record.cron_enabled OR workflow_record.cron_auto_paused THEN
        RETURN NEW;
    END IF;

    -- Extract failure message from formatted_output (same logic as UI)
    IF NEW.status = 'failed' THEN
        -- Try to extract message from formatted_output JSON
        BEGIN
            failure_message := COALESCE(
                NEW.formatted_output::jsonb->>'message',
                NEW.formatted_output::jsonb->'error_summary'->>'error_reason',
                NEW.error_message,
                'Unknown error'
            );
        EXCEPTION WHEN OTHERS THEN
            failure_message := COALESCE(NEW.error_message, 'Unknown error');
        END;

        -- Check if this is the same failure message
        IF workflow_record.last_failure_message = failure_message THEN
            -- Same error - increment counter
            new_consecutive_failures := COALESCE(workflow_record.consecutive_failures, 0) + 1;
        ELSE
            -- Different error - reset counter to 1
            new_consecutive_failures := 1;
        END IF;

        -- Update workflow failure tracking
        UPDATE deployed_workflows
        SET
            consecutive_failures = new_consecutive_failures,
            last_failure_message = failure_message
        WHERE id = NEW.workflow_id;

        -- Check if we need to auto-pause (3 consecutive failures)
        IF new_consecutive_failures >= 3 THEN
            -- Auto-pause the cron job
            UPDATE deployed_workflows
            SET
                cron_enabled = FALSE,
                cron_auto_paused = TRUE,
                auto_paused_at = NOW(),
                auto_pause_reason = format('Auto-paused after %s consecutive failures: %s',
                    new_consecutive_failures,
                    LEFT(failure_message, 200))
            WHERE id = NEW.workflow_id;

            -- Log the auto-pause event
            RAISE NOTICE 'Auto-paused workflow % (%) after % consecutive failures: %',
                workflow_record.id,
                workflow_record.name,
                new_consecutive_failures,
                failure_message;

            -- Trigger notification via pg_notify
            PERFORM pg_notify('cron_auto_paused', json_build_object(
                'workflow_id', NEW.workflow_id,
                'workflow_name', workflow_record.name,
                'consecutive_failures', new_consecutive_failures,
                'failure_message', failure_message,
                'execution_id', NEW.id
            )::text);
        END IF;

    ELSIF NEW.status = 'completed' THEN
        -- Success - reset failure counter if it was tracking failures
        IF workflow_record.consecutive_failures > 0 THEN
            UPDATE deployed_workflows
            SET
                consecutive_failures = 0,
                last_failure_message = NULL
            WHERE id = NEW.workflow_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to check consecutive failures after execution updates
DROP TRIGGER IF EXISTS check_cron_failures_trigger ON workflow_executions;
CREATE TRIGGER check_cron_failures_trigger
    AFTER UPDATE ON workflow_executions
    FOR EACH ROW
    EXECUTE FUNCTION check_cron_consecutive_failures();

-- Grant permissions
GRANT EXECUTE ON FUNCTION check_cron_consecutive_failures() TO authenticated;
GRANT EXECUTE ON FUNCTION check_cron_consecutive_failures() TO service_role;
