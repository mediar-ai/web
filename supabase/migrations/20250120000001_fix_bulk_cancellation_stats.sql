-- Migration: Fix automatic statistics recalculation for bulk cancellations
-- Created: 2025-01-20
-- Description: Add function to recalculate workflow stats and improve trigger system

-- =============================================================================
-- Function to manually recalculate workflow statistics from scratch
-- =============================================================================

CREATE OR REPLACE FUNCTION recalculate_workflow_statistics(p_workflow_id bigint DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
    workflow_record RECORD;
BEGIN
    -- If workflow_id is provided, recalculate only for that workflow
    -- Otherwise, recalculate for all workflows
    FOR workflow_record IN 
        SELECT id, version FROM deployed_workflows 
        WHERE (p_workflow_id IS NULL OR id = p_workflow_id)
    LOOP
        -- Recalculate overall statistics
        UPDATE deployed_workflows
        SET 
            total_executions = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND status IN ('completed', 'failed')
            ),
            successful_runs = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND status = 'completed'
            ),
            failed_runs = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND status = 'failed'
            ),
            cancelled_runs = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND status = 'cancelled'
            ),
            -- Recalculate current version statistics
            current_version_total_executions = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND workflow_version_number = workflow_record.version
                AND status IN ('completed', 'failed')
            ),
            current_version_successful_runs = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND workflow_version_number = workflow_record.version
                AND status = 'completed'
            ),
            current_version_failed_runs = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND workflow_version_number = workflow_record.version
                AND status = 'failed'
            ),
            current_version_cancelled_runs = (
                SELECT COUNT(*) 
                FROM workflow_executions 
                WHERE workflow_id = workflow_record.id 
                AND workflow_version_number = workflow_record.version
                AND status = 'cancelled'
            ),
            updated_at = NOW()
        WHERE id = workflow_record.id;
        
        -- Update current version success rate cache
        UPDATE deployed_workflows
        SET current_version_success_rate = CASE 
            WHEN current_version_total_executions > 0 THEN 
                ROUND((current_version_successful_runs::numeric / current_version_total_executions::numeric) * 100)
            ELSE 0
        END
        WHERE id = workflow_record.id;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Enhanced trigger function that handles bulk updates properly
-- =============================================================================

CREATE OR REPLACE FUNCTION update_workflow_stats()
RETURNS TRIGGER AS $$
DECLARE
    new_avg_duration INT;
    current_version_avg_duration INT;
    current_version TEXT;
BEGIN
    -- Handle bulk updates by checking if OLD values exist
    -- If OLD is NULL, this is likely a bulk INSERT or a direct UPDATE without proper state transition
    IF OLD IS NULL OR NEW.status != OLD.status THEN
        
        -- Get current version for this workflow
        SELECT version INTO current_version
        FROM deployed_workflows
        WHERE id = NEW.workflow_id;
        
        -- Only update stats when status changes to completed, failed, or cancelled
        IF NEW.status IN ('completed', 'failed', 'cancelled') THEN
            
            IF NEW.status = 'completed' THEN
                -- Calculate the new average duration from all successful runs for this workflow
                SELECT AVG(execution_duration_seconds)::INT INTO new_avg_duration
                FROM public.workflow_executions
                WHERE workflow_id = NEW.workflow_id AND status = 'completed';

                -- Update overall workflow stats
                UPDATE public.deployed_workflows 
                SET 
                    successful_runs = successful_runs + 1,
                    total_executions = total_executions + 1,
                    last_successful_execution = NEW.completed_at,
                    estimated_duration_seconds = new_avg_duration,
                    updated_at = now()
                WHERE id = NEW.workflow_id;
                
                -- Update current version stats if this execution was for the current version
                IF NEW.workflow_version_number = current_version THEN
                    SELECT AVG(execution_duration_seconds)::INT INTO current_version_avg_duration
                    FROM public.workflow_executions
                    WHERE workflow_id = NEW.workflow_id 
                    AND workflow_version_number = current_version 
                    AND status = 'completed';
                    
                    UPDATE public.deployed_workflows
                    SET 
                        current_version_successful_runs = current_version_successful_runs + 1,
                        current_version_total_executions = current_version_total_executions + 1
                    WHERE id = NEW.workflow_id;
                END IF;
                
            ELSIF NEW.status = 'failed' THEN
                UPDATE public.deployed_workflows 
                SET 
                    failed_runs = failed_runs + 1,
                    total_executions = total_executions + 1,
                    last_failed_execution = NEW.completed_at,
                    updated_at = now()
                WHERE id = NEW.workflow_id;
                
                -- Update current version stats if this execution was for the current version
                IF NEW.workflow_version_number = current_version THEN
                    UPDATE public.deployed_workflows
                    SET 
                        current_version_failed_runs = current_version_failed_runs + 1,
                        current_version_total_executions = current_version_total_executions + 1
                    WHERE id = NEW.workflow_id;
                END IF;
                
            ELSIF NEW.status = 'cancelled' THEN
                -- Cancelled jobs do NOT count as executions - they never actually executed
                UPDATE public.deployed_workflows 
                SET 
                    cancelled_runs = cancelled_runs + 1,
                    -- Note: total_executions is NOT incremented for cancelled jobs
                    updated_at = now()
                WHERE id = NEW.workflow_id;
                
                -- Update current version stats if this execution was for the current version
                IF NEW.workflow_version_number = current_version THEN
                    UPDATE public.deployed_workflows
                    SET 
                        current_version_cancelled_runs = current_version_cancelled_runs + 1
                        -- Note: current_version_total_executions is NOT incremented for cancelled jobs
                    WHERE id = NEW.workflow_id;
                END IF;
            END IF;
            
            -- Update current version success rate cache
            UPDATE public.deployed_workflows
            SET current_version_success_rate = CASE 
                WHEN current_version_total_executions > 0 THEN 
                    ROUND((current_version_successful_runs::numeric / current_version_total_executions::numeric) * 100)
                ELSE 0
            END
            WHERE id = NEW.workflow_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- Function to handle bulk cancellation with automatic stats recalculation
-- =============================================================================

CREATE OR REPLACE FUNCTION bulk_cancel_executions(
    p_execution_ids bigint[] DEFAULT NULL,
    p_workflow_id bigint DEFAULT NULL,
    p_status_filter text DEFAULT NULL,
    p_reason text DEFAULT 'Bulk cancellation'
)
RETURNS TABLE(
    cancelled_count bigint,
    affected_workflows bigint[]
) AS $$
DECLARE
    affected_workflow_ids bigint[];
    cancellation_count bigint;
BEGIN
    -- Build dynamic query based on parameters
    IF p_execution_ids IS NOT NULL THEN
        -- Cancel specific execution IDs
        UPDATE workflow_executions 
        SET 
            status = 'cancelled',
            updated_at = NOW(),
            error_message = COALESCE(error_message || ' | ', '') || p_reason
        WHERE id = ANY(p_execution_ids)
        AND status NOT IN ('cancelled', 'completed');
        
        -- Get affected workflows
        SELECT ARRAY_AGG(DISTINCT workflow_id) INTO affected_workflow_ids
        FROM workflow_executions 
        WHERE id = ANY(p_execution_ids);
        
    ELSIF p_workflow_id IS NOT NULL THEN
        -- Cancel all executions for a specific workflow
        UPDATE workflow_executions 
        SET 
            status = 'cancelled',
            updated_at = NOW(),
            error_message = COALESCE(error_message || ' | ', '') || p_reason
        WHERE workflow_id = p_workflow_id
        AND (p_status_filter IS NULL OR status = p_status_filter)
        AND status NOT IN ('cancelled', 'completed');
        
        affected_workflow_ids := ARRAY[p_workflow_id];
        
    ELSE
        -- Cancel all executions matching status filter
        UPDATE workflow_executions 
        SET 
            status = 'cancelled',
            updated_at = NOW(),
            error_message = COALESCE(error_message || ' | ', '') || p_reason
        WHERE (p_status_filter IS NULL OR status = p_status_filter)
        AND status NOT IN ('cancelled', 'completed');
        
        -- Get all affected workflows
        SELECT ARRAY_AGG(DISTINCT workflow_id) INTO affected_workflow_ids
        FROM workflow_executions 
        WHERE status = 'cancelled'
        AND updated_at > NOW() - INTERVAL '1 minute'; -- Recently updated
    END IF;
    
    GET DIAGNOSTICS cancellation_count = ROW_COUNT;
    
    -- Recalculate statistics for all affected workflows
    IF affected_workflow_ids IS NOT NULL THEN
        FOR i IN 1..array_length(affected_workflow_ids, 1) LOOP
            PERFORM recalculate_workflow_statistics(affected_workflow_ids[i]);
        END LOOP;
    END IF;
    
    -- Return results
    RETURN QUERY SELECT cancellation_count, affected_workflow_ids;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Add comments for documentation
-- =============================================================================

COMMENT ON FUNCTION recalculate_workflow_statistics(bigint) IS 
'Manually recalculates workflow statistics from actual execution data. Use after bulk updates that bypass triggers.';

COMMENT ON FUNCTION bulk_cancel_executions(bigint[], bigint, text, text) IS 
'Safely cancel multiple executions with automatic statistics recalculation. Handles bulk operations properly.';

-- =============================================================================
-- Grant permissions
-- =============================================================================

-- Grant execute permissions to service role for API usage
GRANT EXECUTE ON FUNCTION recalculate_workflow_statistics(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION bulk_cancel_executions(bigint[], bigint, text, text) TO service_role; 