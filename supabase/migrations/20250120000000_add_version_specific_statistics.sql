-- Migration: Add version-specific statistics functionality
-- Created: 2025-01-20
-- Description: Adds functions and views to calculate statistics for both overall workflow and current version

-- =============================================================================
-- Add version-specific statistics columns to deployed_workflows table
-- =============================================================================

-- Add columns for current version statistics (cached for performance)
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS current_version_successful_runs integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_version_failed_runs integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_version_cancelled_runs integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_version_total_executions integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_version_success_rate integer DEFAULT 0;

-- Add comments
COMMENT ON COLUMN public.deployed_workflows.current_version_successful_runs IS 'Successful runs for the currently active version only';
COMMENT ON COLUMN public.deployed_workflows.current_version_failed_runs IS 'Failed runs for the currently active version only';
COMMENT ON COLUMN public.deployed_workflows.current_version_cancelled_runs IS 'Cancelled runs for the currently active version only';
COMMENT ON COLUMN public.deployed_workflows.current_version_total_executions IS 'Total executions for the currently active version only';
COMMENT ON COLUMN public.deployed_workflows.current_version_success_rate IS 'Cached success rate percentage for current version';

-- =============================================================================
-- Function to calculate version-specific statistics
-- =============================================================================

CREATE OR REPLACE FUNCTION get_workflow_version_statistics(
    p_workflow_id bigint,
    p_version_number text DEFAULT NULL
) RETURNS TABLE(
    version_number text,
    total_executions bigint,
    successful_runs bigint,
    failed_runs bigint,
    cancelled_runs bigint,
    success_rate numeric,
    average_duration_seconds numeric,
    last_successful_execution timestamptz,
    last_failed_execution timestamptz
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        we.workflow_version_number,
        COUNT(*) as total_executions,
        COUNT(*) FILTER (WHERE we.status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE we.status = 'failed') as failed_runs,
        COUNT(*) FILTER (WHERE we.status = 'cancelled') as cancelled_runs,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND((COUNT(*) FILTER (WHERE we.status = 'completed')::numeric / COUNT(*)::numeric) * 100, 1)
            ELSE 0
        END as success_rate,
        ROUND(AVG(we.execution_duration_seconds) FILTER (WHERE we.status = 'completed'), 1) as average_duration_seconds,
        MAX(we.completed_at) FILTER (WHERE we.status = 'completed') as last_successful_execution,
        MAX(we.completed_at) FILTER (WHERE we.status = 'failed') as last_failed_execution
    FROM workflow_executions we
    WHERE we.workflow_id = p_workflow_id 
    AND we.workflow_version_number IS NOT NULL
    AND (p_version_number IS NULL OR we.workflow_version_number = p_version_number)
    GROUP BY we.workflow_version_number
    ORDER BY we.workflow_version_number DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Function to get combined workflow statistics (overall + current version)
-- =============================================================================

CREATE OR REPLACE FUNCTION get_combined_workflow_statistics(p_workflow_id bigint)
RETURNS TABLE(
    workflow_id bigint,
    workflow_name text,
    current_version text,
    overall_stats jsonb,
    current_version_stats jsonb,
    version_history jsonb
) AS $$
DECLARE
    v_workflow record;
    v_overall_stats jsonb;
    v_current_version_stats jsonb;
    v_version_history jsonb;
BEGIN
    -- Get workflow basic info
    SELECT w.id, w.name, w.version, w.successful_runs, w.failed_runs, w.cancelled_runs, w.total_executions,
           w.estimated_duration_seconds, w.last_successful_execution, w.last_failed_execution
    INTO v_workflow
    FROM deployed_workflows w
    WHERE w.id = p_workflow_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workflow % not found', p_workflow_id;
    END IF;

    -- Build overall statistics
    v_overall_stats := jsonb_build_object(
        'total_executions', v_workflow.total_executions,
        'successful_runs', v_workflow.successful_runs,
        'failed_runs', v_workflow.failed_runs,
        'cancelled_runs', v_workflow.cancelled_runs,
        'success_rate', CASE 
            WHEN v_workflow.total_executions > 0 THEN 
                ROUND((v_workflow.successful_runs::numeric / v_workflow.total_executions::numeric) * 100, 1)
            ELSE 0
        END,
        'average_duration_seconds', v_workflow.estimated_duration_seconds,
        'last_successful_execution', v_workflow.last_successful_execution,
        'last_failed_execution', v_workflow.last_failed_execution
    );

    -- Get current version statistics
    SELECT jsonb_agg(
        jsonb_build_object(
            'version_number', vs.version_number,
            'total_executions', vs.total_executions,
            'successful_runs', vs.successful_runs,
            'failed_runs', vs.failed_runs,
            'cancelled_runs', vs.cancelled_runs,
            'success_rate', vs.success_rate,
            'average_duration_seconds', vs.average_duration_seconds,
            'last_successful_execution', vs.last_successful_execution,
            'last_failed_execution', vs.last_failed_execution
        )
    ) INTO v_current_version_stats
    FROM get_workflow_version_statistics(p_workflow_id, v_workflow.version) vs;

    -- Get all version history
    SELECT jsonb_agg(
        jsonb_build_object(
            'version_number', vs.version_number,
            'total_executions', vs.total_executions,
            'successful_runs', vs.successful_runs,
            'failed_runs', vs.failed_runs,
            'cancelled_runs', vs.cancelled_runs,
            'success_rate', vs.success_rate,
            'average_duration_seconds', vs.average_duration_seconds,
            'last_successful_execution', vs.last_successful_execution,
            'last_failed_execution', vs.last_failed_execution
        )
        ORDER BY vs.version_number DESC
    ) INTO v_version_history
    FROM get_workflow_version_statistics(p_workflow_id) vs;

    -- Return combined results
    RETURN QUERY SELECT 
        v_workflow.id,
        v_workflow.name,
        v_workflow.version,
        v_overall_stats,
        COALESCE(v_current_version_stats, '[]'::jsonb),
        COALESCE(v_version_history, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Create view for easy access to workflow statistics
-- =============================================================================

CREATE OR REPLACE VIEW workflow_statistics_summary AS
SELECT 
    w.id,
    w.name,
    w.version as current_version,
    w.status,
    w.category,
    -- Overall statistics
    w.total_executions as overall_total_executions,
    w.successful_runs as overall_successful_runs,
    w.failed_runs as overall_failed_runs,
    w.cancelled_runs as overall_cancelled_runs,
    CASE 
        WHEN w.total_executions > 0 THEN 
            ROUND((w.successful_runs::numeric / w.total_executions::numeric) * 100, 1)
        ELSE 0
    END as overall_success_rate,
    -- Current version statistics (calculated from executions)
    COALESCE(cv.total_executions, 0) as current_version_total_executions,
    COALESCE(cv.successful_runs, 0) as current_version_successful_runs,
    COALESCE(cv.failed_runs, 0) as current_version_failed_runs,
    COALESCE(cv.cancelled_runs, 0) as current_version_cancelled_runs,
    COALESCE(cv.success_rate, 0) as current_version_success_rate,
    COALESCE(cv.average_duration_seconds, w.estimated_duration_seconds) as current_version_avg_duration,
    -- Metadata
    w.total_versions,
    w.current_version_id,
    w.created_at,
    w.updated_at
FROM deployed_workflows w
LEFT JOIN LATERAL (
    SELECT 
        COUNT(*) as total_executions,
        COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_runs,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND((COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*)::numeric) * 100, 1)
            ELSE 0
        END as success_rate,
        ROUND(AVG(execution_duration_seconds) FILTER (WHERE status = 'completed'), 1) as average_duration_seconds
    FROM workflow_executions we 
    WHERE we.workflow_id = w.id 
    AND we.workflow_version_number = w.version
) cv ON true;

-- =============================================================================
-- Update the existing workflow stats trigger to maintain version-specific stats
-- =============================================================================

CREATE OR REPLACE FUNCTION update_workflow_stats()
RETURNS TRIGGER AS $$
DECLARE
    new_avg_duration INT;
    current_version_avg_duration INT;
    current_version TEXT;
BEGIN
    -- Only update stats when status changes to completed, failed, or cancelled
    IF NEW.status IN ('completed', 'failed', 'cancelled') AND OLD.status NOT IN ('completed', 'failed', 'cancelled') THEN
        
        -- Get current version for this workflow
        SELECT version INTO current_version
        FROM deployed_workflows
        WHERE id = NEW.workflow_id;
        
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
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- =============================================================================
-- Add comments for documentation
-- =============================================================================

COMMENT ON FUNCTION get_workflow_version_statistics(bigint, text) IS 
'Calculates execution statistics for a specific workflow version or all versions';

COMMENT ON FUNCTION get_combined_workflow_statistics(bigint) IS 
'Returns comprehensive statistics including overall, current version, and version history';

COMMENT ON VIEW workflow_statistics_summary IS 
'Convenient view showing both overall and current version statistics for all workflows';

-- =============================================================================
-- Backfill current version statistics for existing workflows
-- =============================================================================

-- Update current version statistics for all existing workflows
UPDATE public.deployed_workflows
SET 
    current_version_successful_runs = COALESCE(cv_stats.successful_runs, 0),
    current_version_failed_runs = COALESCE(cv_stats.failed_runs, 0),
    current_version_cancelled_runs = COALESCE(cv_stats.cancelled_runs, 0),
    current_version_total_executions = COALESCE(cv_stats.total_executions, 0),
    current_version_success_rate = COALESCE(cv_stats.success_rate, 0)
FROM (
    SELECT 
        we.workflow_id,
        COUNT(*) as total_executions,
        COUNT(*) FILTER (WHERE we.status = 'completed') as successful_runs,
        COUNT(*) FILTER (WHERE we.status = 'failed') as failed_runs,
        COUNT(*) FILTER (WHERE we.status = 'cancelled') as cancelled_runs,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND((COUNT(*) FILTER (WHERE we.status = 'completed')::numeric / COUNT(*)::numeric) * 100)
            ELSE 0
        END as success_rate
    FROM workflow_executions we
    JOIN deployed_workflows dw ON we.workflow_id = dw.id AND we.workflow_version_number = dw.version
    WHERE we.workflow_version_number IS NOT NULL
    GROUP BY we.workflow_id
) cv_stats
WHERE deployed_workflows.id = cv_stats.workflow_id; 