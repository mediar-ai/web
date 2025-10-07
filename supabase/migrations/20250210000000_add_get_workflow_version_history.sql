-- ============================================================================
-- Migration: Add Workflow Version Management Functions
-- Created: 2025-02-10
-- Description: Creates functions for version history and activation
-- ============================================================================

-- ============================================================================
-- Function 1: get_workflow_version_history
-- Purpose: Retrieve version history with execution counts for UI display
-- ============================================================================
CREATE OR REPLACE FUNCTION get_workflow_version_history(p_workflow_id bigint)
RETURNS TABLE (
    version_id bigint,
    version_number text,
    is_active boolean,
    created_at timestamptz,
    change_notes text,
    execution_count bigint
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.id as version_id,
        v.version_number,
        v.is_active,
        v.created_at,
        COALESCE(v.change_notes, '') as change_notes,
        COALESCE(COUNT(e.id), 0) as execution_count
    FROM
        deployed_workflow_versions v
    LEFT JOIN
        workflow_executions e
        ON e.workflow_id = v.workflow_id
        AND e.workflow_version_number = v.version_number
    WHERE
        v.workflow_id = p_workflow_id
    GROUP BY
        v.id, v.version_number, v.is_active, v.created_at, v.change_notes
    ORDER BY
        v.created_at DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_workflow_version_history(bigint) IS
'Returns version history for a workflow with execution counts per version';

-- ============================================================================
-- Function 2: activate_workflow_version
-- Purpose: Activate a specific version and update workflow's current_version_id
-- ============================================================================
CREATE OR REPLACE FUNCTION activate_workflow_version(
    p_workflow_id bigint,
    p_version_number text
) RETURNS void AS $$
DECLARE
    v_version_id bigint;
    v_current_active_version_id bigint;
BEGIN
    -- Get the version ID to activate
    SELECT id INTO v_version_id
    FROM deployed_workflow_versions
    WHERE workflow_id = p_workflow_id
      AND version_number = p_version_number;

    IF v_version_id IS NULL THEN
        RAISE EXCEPTION 'Version % not found for workflow %', p_version_number, p_workflow_id;
    END IF;

    -- Get current active version ID (if any)
    SELECT id INTO v_current_active_version_id
    FROM deployed_workflow_versions
    WHERE workflow_id = p_workflow_id
      AND is_active = true;

    -- Deactivate all other versions for this workflow
    UPDATE deployed_workflow_versions
    SET is_active = false,
        updated_at = NOW()
    WHERE workflow_id = p_workflow_id
      AND is_active = true;

    -- Activate the target version
    UPDATE deployed_workflow_versions
    SET is_active = true,
        updated_at = NOW()
    WHERE id = v_version_id;

    -- Update the workflow's current_version_id and version number
    UPDATE deployed_workflows
    SET current_version_id = v_version_id,
        version = p_version_number,
        updated_at = NOW()
    WHERE id = p_workflow_id;

    RAISE NOTICE 'Activated version % (ID: %) for workflow %', p_version_number, v_version_id, p_workflow_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION activate_workflow_version(bigint, text) IS
'Activates a specific workflow version and updates current_version_id. Ensures cron and executions use the correct version.';
