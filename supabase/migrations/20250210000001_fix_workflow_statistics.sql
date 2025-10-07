-- ============================================================================
-- Migration: Fix Workflow Statistics
-- Created: 2025-02-10
-- Description: Recalculates and backfills workflow statistics from executions
-- ============================================================================

-- ============================================================================
-- Function to recalculate workflow statistics
-- ============================================================================
CREATE OR REPLACE FUNCTION recalculate_workflow_statistics(p_workflow_id bigint DEFAULT NULL)
RETURNS TABLE (
    workflow_id bigint,
    workflows_updated integer,
    message text
) AS $$
DECLARE
    v_workflows_updated integer := 0;
    v_workflow_record record;
BEGIN
    -- If specific workflow ID provided, update only that workflow
    -- Otherwise update all workflows
    FOR v_workflow_record IN
        SELECT id, name FROM deployed_workflows
        WHERE (p_workflow_id IS NULL OR id = p_workflow_id)
    LOOP
        -- Update overall workflow statistics from ALL executions
        WITH stats AS (
            SELECT
                COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) as total_executions,
                COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_runs,
                MAX(completed_at) FILTER (WHERE status = 'completed') as last_successful_execution,
                MAX(completed_at) FILTER (WHERE status = 'failed') as last_failed_execution,
                AVG(execution_duration_seconds) FILTER (WHERE status = 'completed') as avg_duration
            FROM workflow_executions
            WHERE workflow_id = v_workflow_record.id
        )
        UPDATE deployed_workflows w
        SET
            total_executions = COALESCE((SELECT total_executions FROM stats), 0),
            successful_runs = COALESCE((SELECT successful_runs FROM stats), 0),
            failed_runs = COALESCE((SELECT failed_runs FROM stats), 0),
            cancelled_runs = COALESCE((SELECT cancelled_runs FROM stats), 0),
            last_successful_execution = (SELECT last_successful_execution FROM stats),
            last_failed_execution = (SELECT last_failed_execution FROM stats),
            estimated_duration_seconds = COALESCE((SELECT avg_duration::integer FROM stats), 0),
            updated_at = NOW()
        WHERE w.id = v_workflow_record.id;

        -- Update current version statistics
        WITH current_version_stats AS (
            SELECT
                COUNT(*) FILTER (WHERE status IN ('completed', 'failed')) as total_executions,
                COUNT(*) FILTER (WHERE status = 'completed') as successful_runs,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_runs,
                COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_runs
            FROM workflow_executions we
            JOIN deployed_workflows dw ON we.workflow_id = dw.id
            WHERE we.workflow_id = v_workflow_record.id
              AND we.workflow_version_number = dw.version
        )
        UPDATE deployed_workflows w
        SET
            current_version_total_executions = COALESCE((SELECT total_executions FROM current_version_stats), 0),
            current_version_successful_runs = COALESCE((SELECT successful_runs FROM current_version_stats), 0),
            current_version_failed_runs = COALESCE((SELECT failed_runs FROM current_version_stats), 0),
            current_version_cancelled_runs = COALESCE((SELECT cancelled_runs FROM current_version_stats), 0),
            current_version_success_rate = CASE
                WHEN (SELECT total_executions FROM current_version_stats) > 0 THEN
                    ROUND(((SELECT successful_runs FROM current_version_stats)::numeric / (SELECT total_executions FROM current_version_stats)::numeric) * 100)
                ELSE 0
            END
        WHERE w.id = v_workflow_record.id;

        v_workflows_updated := v_workflows_updated + 1;
    END LOOP;

    RETURN QUERY SELECT
        COALESCE(p_workflow_id, 0::bigint),
        v_workflows_updated,
        CASE
            WHEN p_workflow_id IS NULL THEN
                'Recalculated statistics for ' || v_workflows_updated || ' workflows'
            ELSE
                'Recalculated statistics for workflow ' || p_workflow_id
        END;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_workflow_statistics(bigint) IS
'Recalculates workflow statistics from workflow_executions table. Call with NULL to update all workflows.';

-- ============================================================================
-- Backfill statistics for ALL workflows
-- ============================================================================

SELECT * FROM recalculate_workflow_statistics(NULL);
