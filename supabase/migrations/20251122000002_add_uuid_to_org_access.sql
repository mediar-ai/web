-- Migration: Add workflow_uuid to workflow_organization_access
-- Created: 2025-11-22
-- Purpose: Enable UUID-based workflow access checks

-- Add workflow_uuid column
ALTER TABLE workflow_organization_access
ADD COLUMN workflow_uuid UUID REFERENCES deployed_workflows(uuid) ON DELETE CASCADE;

-- Create index for fast lookups
CREATE INDEX idx_workflow_org_access_uuid ON workflow_organization_access(workflow_uuid);

-- Backfill workflow_uuid from existing workflow_id mappings
UPDATE workflow_organization_access woa
SET workflow_uuid = dw.uuid
FROM deployed_workflows dw
WHERE woa.workflow_id = dw.id AND woa.workflow_uuid IS NULL;

-- Verify backfill
DO $$
DECLARE
  total_count INT;
  backfilled_count INT;
BEGIN
  SELECT COUNT(*) INTO total_count FROM workflow_organization_access;
  SELECT COUNT(*) INTO backfilled_count FROM workflow_organization_access WHERE workflow_uuid IS NOT NULL;
  
  RAISE NOTICE 'Organization workflow access backfill: % / % rows updated', backfilled_count, total_count;
  
  IF backfilled_count < total_count THEN
    RAISE WARNING 'Some rows were not backfilled - check for orphaned workflow_id references';
  END IF;
END $$;
