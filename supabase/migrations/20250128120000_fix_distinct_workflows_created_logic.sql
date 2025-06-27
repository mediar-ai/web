-- SOLUTION: Query low_level_workflows table directly instead of session-level triggers
-- 
-- PROBLEM IDENTIFIED: distinct_workflows_created was session-level data, but workflows are user-level
-- - A user might have 50 sessions but only 5 workflows
-- - Trying to store workflow counts per session created conceptual mismatch
--
-- SOLUTION IMPLEMENTED:
-- 1. Updated /api/sessions to query low_level_workflows table directly
-- 2. Added workflowCount field to UserSessionData interface
-- 3. Admin dashboard now shows user-level workflow counts (not session-level)
-- 4. Workflow counts match actual synthesized workflows from /workflow tab
--
-- RESULTS:
-- - User f717970e-11f4-2107-f717-970e11f42107: 2 workflows  
-- - User 29303245-5cbb-671e-2930-32455cbb671e: 10 workflows
-- - User 8c36c7fa-334c-c691-8c36-c7fa334cc691: 2 workflows
-- (Verified against actual low_level_workflows table with 14 total workflows)

-- =====================================================================
-- Clean up: Remove session-level workflow count field (no longer used)
-- =====================================================================
ALTER TABLE public.session_metadata DROP COLUMN IF EXISTS distinct_workflows_created;

-- Add comment explaining the new approach
COMMENT ON TABLE public.low_level_workflows IS 'Stores user-level synthesized workflows. Admin dashboard queries this table directly for workflow counts instead of storing counts in session_metadata.'; 