-- Migration: Fix deployed_workflows_with_sequence view to support 'deployed' status
-- Date: 2025-10-14
-- Issue: View was filtering by status='active' but all workflows have status='deployed'
-- Result: View returned 0 rows, causing cron schedules to not display in workflow table
-- Impact: 4 workflows with active cron schedules were not showing schedule info in UI

-- Drop the existing view
DROP VIEW IF EXISTS public.deployed_workflows_with_sequence CASCADE;

-- Recreate view with updated filter to support both 'active' and 'deployed' statuses
CREATE OR REPLACE VIEW public.deployed_workflows_with_sequence AS
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
    dw.github_path
FROM deployed_workflows dw
WHERE dw.status IN ('active', 'deployed');

-- Verification query:
-- SELECT COUNT(*) FROM public.deployed_workflows_with_sequence;
-- Expected: 14+ rows (previously returned 0)

-- Verify cron workflows are now included:
-- SELECT dwws.id, dwws.name, dw.cron_expression, dw.cron_enabled
-- FROM deployed_workflows_with_sequence dwws
-- JOIN deployed_workflows dw ON dwws.id = dw.id
-- WHERE dw.cron_expression IS NOT NULL;
-- Expected: 4 workflows with cron schedules
