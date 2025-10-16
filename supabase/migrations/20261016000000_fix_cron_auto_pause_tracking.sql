-- Migration: Fix cron auto-pause tracking to continue monitoring after auto-pause
-- Created: 2026-10-16
-- Description: Fix trigger to continue tracking consecutive failures even when auto-paused
--              and update view to expose cron_auto_paused flag

-- 1. Update the trigger function to continue tracking failures when auto-paused
CREATE OR REPLACE FUNCTION check_cron_consecutive_failures()
RETURNS TRIGGER AS $$
DECLARE
    workflow_record RECORD;
    failure_message TEXT;
    new_consecutive_failures INTEGER;
    should_track BOOLEAN;
BEGIN
    -- Only check when execution completes (status changes to completed or failed)
    IF NEW.status NOT IN ('completed', 'failed') OR OLD.status IN ('completed', 'failed') THEN
        RETURN NEW;
    END IF;

    -- Get workflow details
    SELECT id, name, cron_enabled, consecutive_failures, last_failure_message, cron_auto_paused
    INTO workflow_record
    FROM deployed_workflows
    WHERE id = NEW.workflow_id;

    -- Determine if we should track this execution:
    -- - Track if cron was enabled when this execution started (regardless of current state)
    -- - This ensures we track failures even if workflow was auto-paused after execution started
    -- - We identify cron executions by checking if there's a cron schedule configured
    SELECT EXISTS(
        SELECT 1 FROM deployed_workflows
        WHERE id = NEW.workflow_id
        AND cron_expression IS NOT NULL
    ) INTO should_track;

    -- Skip if workflow doesn't have cron configured
    IF NOT should_track THEN
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

        -- Update workflow failure tracking (always track, even if already auto-paused)
        UPDATE deployed_workflows
        SET
            consecutive_failures = new_consecutive_failures,
            last_failure_message = failure_message
        WHERE id = NEW.workflow_id;

        -- Check if we need to auto-pause (3 consecutive failures)
        -- Only auto-pause if not already auto-paused
        IF new_consecutive_failures >= 3 AND NOT workflow_record.cron_auto_paused THEN
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
        ELSIF new_consecutive_failures >= 3 AND workflow_record.cron_auto_paused THEN
            -- Already auto-paused but still failing - send additional alert
            RAISE NOTICE 'Workflow % (%) still failing after auto-pause: % consecutive failures with message: %',
                workflow_record.id,
                workflow_record.name,
                new_consecutive_failures,
                failure_message;

            -- Send notification about ongoing failures
            PERFORM pg_notify('cron_still_failing', json_build_object(
                'workflow_id', NEW.workflow_id,
                'workflow_name', workflow_record.name,
                'consecutive_failures', new_consecutive_failures,
                'failure_message', failure_message,
                'execution_id', NEW.id,
                'auto_paused_at', workflow_record.auto_paused_at
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

-- 2. Update the deployed_workflows_with_sequence view to include cron_auto_paused
CREATE OR REPLACE VIEW deployed_workflows_with_sequence AS
SELECT
    dw.id,
    dw.name,
    dw.description,
    dw.version,
    dw.status,
    dw.automation_sequence,
    dw.automation_sequence_yaml,
    dw.category,
    dw.created_by,
    dw.created_at,
    dw.updated_at,
    dw.github_folder,
    dw.github_ref,
    dw.github_path,
    dw.workflow_type,
    dw.parent_workflow_id,
    dw.display_order,
    dw.cron_expression,
    dw.cron_timezone,
    dw.cron_enabled,
    dw.last_scheduled_execution,
    dw.next_scheduled_execution,
    dw.cron_max_concurrent,
    dw.cron_retry_on_failure,
    dw.cron_retry_count,
    dw.cron_auto_paused,           -- NEW: Expose auto-pause flag
    dw.consecutive_failures,        -- NEW: Expose failure counter
    dw.last_failure_message,        -- NEW: Expose last failure message
    dw.auto_paused_at,             -- NEW: Expose auto-pause timestamp
    dw.auto_pause_reason,          -- NEW: Expose auto-pause reason
    dw.organization_id
FROM deployed_workflows dw
WHERE dw.status IN ('active', 'deployed');

-- 3. Add comment explaining the fix
COMMENT ON FUNCTION check_cron_consecutive_failures() IS
'Tracks consecutive failures for workflows with cron schedules.
After 3 consecutive failures with the same error message, automatically disables cron.
IMPORTANT: Continues tracking failures even after auto-pause to detect ongoing issues.
Updated 2026-10-16 to fix tracking when auto-paused.';
