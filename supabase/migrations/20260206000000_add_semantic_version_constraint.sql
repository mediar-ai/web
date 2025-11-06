-- ============================================================================
-- Migration: Add Semantic Version Constraint
-- Created: 2026-02-06
-- Description: Enforces semantic versioning (X.Y.Z) format on version_number
--              and cleans up existing invalid timestamp versions
-- ============================================================================

-- ============================================================================
-- STEP 1: Deactivate all invalid (non-semantic) versions
-- ============================================================================
-- Find and deactivate any versions that don't match X.Y.Z format
UPDATE deployed_workflow_versions
SET is_active = false,
    updated_at = NOW()
WHERE version_number !~ '^\d+\.\d+\.\d+$'
  AND is_active = true;

-- Log how many invalid versions were deactivated
DO $$
DECLARE
    invalid_count integer;
BEGIN
    SELECT COUNT(*) INTO invalid_count
    FROM deployed_workflow_versions
    WHERE version_number !~ '^\d+\.\d+\.\d+$';
    
    RAISE NOTICE 'Found % invalid version(s) with non-semantic version numbers', invalid_count;
END $$;

-- ============================================================================
-- STEP 2: For each affected workflow, activate the latest VALID semantic version
-- ============================================================================
DO $$
DECLARE
    workflow_record RECORD;
    latest_valid_version RECORD;
BEGIN
    -- Find all workflows that have invalid active versions
    FOR workflow_record IN
        SELECT DISTINCT workflow_id
        FROM deployed_workflow_versions
        WHERE version_number !~ '^\d+\.\d+\.\d+$'
    LOOP
        -- Find the latest valid semantic version for this workflow
        SELECT id, version_number INTO latest_valid_version
        FROM deployed_workflow_versions
        WHERE workflow_id = workflow_record.workflow_id
          AND version_number ~ '^\d+\.\d+\.\d+$'
        ORDER BY created_at DESC
        LIMIT 1;
        
        IF FOUND THEN
            -- Activate this version
            UPDATE deployed_workflow_versions
            SET is_active = true,
                updated_at = NOW()
            WHERE id = latest_valid_version.id;
            
            -- Update the workflow's current_version_id and version number
            UPDATE deployed_workflows
            SET current_version_id = latest_valid_version.id,
                version = latest_valid_version.version_number,
                updated_at = NOW()
            WHERE id = workflow_record.workflow_id;
            
            RAISE NOTICE 'Workflow %: Activated latest valid version %',
                workflow_record.workflow_id, latest_valid_version.version_number;
        ELSE
            RAISE WARNING 'Workflow % has no valid semantic versions! Keeping invalid version active.',
                workflow_record.workflow_id;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- STEP 3: Delete invalid versions BEFORE adding constraint
-- ============================================================================
-- We MUST delete invalid versions before adding the CHECK constraint
-- Otherwise the constraint creation will fail

DELETE FROM deployed_workflow_versions
WHERE version_number !~ '^\d+\.\d+\.\d+$';

-- Log deletion
DO $$
DECLARE
    deleted_count integer;
BEGIN
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'Deleted % invalid (non-semantic) version record(s)', deleted_count;
END $$;

-- ============================================================================
-- STEP 4: Add CHECK constraint to prevent future invalid versions
-- ============================================================================
-- Now safe to add constraint since all invalid versions are removed
-- Use IF NOT EXISTS pattern for idempotency (Postgres 16+)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'version_number_semantic_format'
        AND conrelid = 'deployed_workflow_versions'::regclass
    ) THEN
        ALTER TABLE deployed_workflow_versions
        ADD CONSTRAINT version_number_semantic_format
        CHECK (version_number ~ '^\d+\.\d+\.\d+$');
        
        RAISE NOTICE 'Added semantic version constraint';
    ELSE
        RAISE NOTICE 'Semantic version constraint already exists, skipping';
    END IF;
END $$;

COMMENT ON CONSTRAINT version_number_semantic_format ON deployed_workflow_versions IS
'Ensures version_number follows semantic versioning format (e.g., 1.0.1, 2.5.13)';

-- ============================================================================
-- Verification Query (for manual testing)
-- ============================================================================
-- Run this query to verify the migration:
-- 
-- SELECT 
--     workflow_id,
--     version_number,
--     is_active,
--     created_at,
--     CASE 
--         WHEN version_number ~ '^\d+\.\d+\.\d+$' THEN 'VALID'
--         ELSE 'INVALID'
--     END as version_status
-- FROM deployed_workflow_versions
-- WHERE workflow_id = 128  -- Replace with your workflow ID
-- ORDER BY created_at DESC;

