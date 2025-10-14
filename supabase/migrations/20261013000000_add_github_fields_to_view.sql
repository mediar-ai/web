-- Migration: Add github_folder and github_ref to deployed_workflows_with_sequence view
-- Created: 2026-10-13
-- Description: The view was missing github_folder and github_ref columns needed by Rust executor
-- Note: Must DROP and recreate because columns were removed from previous view definition

-- Drop existing view (CASCADE removes dependencies)
DROP VIEW IF EXISTS deployed_workflows_with_sequence CASCADE;

-- Recreate view with only columns that exist after 20260109000000_remove_unused_workflow_fields migration
CREATE VIEW deployed_workflows_with_sequence AS
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
    -- Add GitHub tracking fields (MISSING from previous view definition)
    dw.github_folder,
    dw.github_ref,
    dw.github_path
FROM public.deployed_workflows dw
WHERE dw.status = 'active';

-- Grant permissions on the view
GRANT SELECT ON deployed_workflows_with_sequence TO authenticated;
GRANT SELECT ON deployed_workflows_with_sequence TO anon;

-- Add comment for documentation
COMMENT ON VIEW deployed_workflows_with_sequence IS 'View of active workflows with GitHub tracking fields for Rust executor compatibility';
