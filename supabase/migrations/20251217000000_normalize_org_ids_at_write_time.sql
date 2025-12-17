-- Migration: Normalize org IDs at write time
-- Created: 2025-12-17
-- Purpose: Fix dev/prod Clerk org ID mismatch by normalizing at write time
--
-- Problem: Desktop sessions store Clerk dev org IDs, but DB expects prod org IDs.
-- Solution: Always map dev->prod org IDs when writing to database (in TypeScript).
--
-- This migration:
-- 1. Migrates existing workflows with dev org ID to prod org ID
-- 2. Ensures get_workflow_access_level uses simple comparison (no hardcoded mapping)
--
-- Related TypeScript change: mapClerkIdToDbId() now always applies mapping (removed NODE_ENV check)

-- Migrate existing Mediar workflows from dev to prod org ID
UPDATE deployed_workflows
SET organization_id = 'org_REDACTED'
WHERE organization_id = 'org_REDACTED';

-- Migrate existing Example workflows from dev to prod org ID (if any)
UPDATE deployed_workflows
SET organization_id = 'org_REDACTED'
WHERE organization_id = 'org_REDACTED';

-- Ensure SQL function uses simple comparison (no hardcoded mapping needed)
-- This is the original function from 20251210000000_fix_owner_access_status_check.sql
CREATE OR REPLACE FUNCTION public.get_workflow_access_level(p_org_id text, p_workflow_uuid uuid)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT CASE
    -- Check 1: Organization owns the workflow (owner can access ANY status)
    WHEN EXISTS (
      SELECT 1 FROM deployed_workflows dw
      WHERE dw.uuid = p_workflow_uuid
        AND dw.organization_id = p_org_id
    ) THEN 'owner'

    -- Check 2: Organization has explicit access via workflow_organization_access
    WHEN EXISTS (
      SELECT 1 FROM workflow_organization_access woa
      JOIN deployed_workflows dw ON dw.uuid = woa.workflow_uuid
      WHERE woa.organization_id = p_org_id
        AND dw.uuid = p_workflow_uuid
        AND dw.status = 'deployed'
    ) THEN (
      SELECT woa.access_level
      FROM workflow_organization_access woa
      JOIN deployed_workflows dw ON dw.uuid = woa.workflow_uuid
      WHERE woa.organization_id = p_org_id
        AND dw.uuid = p_workflow_uuid
      LIMIT 1
    )

    -- Check 3: Workflow is public (read-only access)
    WHEN EXISTS (
      SELECT 1 FROM deployed_workflows dw
      WHERE dw.uuid = p_workflow_uuid
        AND dw.is_public = true
        AND dw.status = 'deployed'
    ) THEN 'public_read'

    -- No access
    ELSE NULL
  END;
$function$;

COMMENT ON FUNCTION public.get_workflow_access_level IS 'Get workflow access level for an organization. Returns owner/admin/write/read/public_read or NULL. Owners can access workflows in any status.';
