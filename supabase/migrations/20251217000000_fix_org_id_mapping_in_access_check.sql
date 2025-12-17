-- Migration: Fix get_workflow_access_level to handle dev/prod Clerk org ID mismatch
-- Created: 2025-12-17
-- Purpose: When checking ownership, also check for the corresponding dev Clerk org ID
-- This handles the case where workflow was created with dev Clerk ID but access check uses mapped prod ID
--
-- Mapping (hardcoded for now, matches orgIdMapping.ts):
-- Dev Clerk ID: org_2yydAO45WOB4RaCE4F4BNUPtw9c -> Prod DB ID: org_2yynzGa53bNM1GTPLp5mc2lYRyD
-- Dev Clerk ID: org_2yycYh2ig5m8LwgONhJfZGYhkm9 -> Prod DB ID: org_2yyo35c5YVUqjJ86qen45VfwwxD

CREATE OR REPLACE FUNCTION public.get_workflow_access_level(p_org_id text, p_workflow_uuid uuid)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT CASE
    -- Check 1: Organization owns the workflow (owner can access ANY status)
    -- Also check for corresponding dev Clerk org IDs to handle mapping mismatch
    WHEN EXISTS (
      SELECT 1 FROM deployed_workflows dw
      WHERE dw.uuid = p_workflow_uuid
        AND (
          dw.organization_id = p_org_id
          -- Handle Mediar org dev/prod mismatch
          OR (p_org_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD' AND dw.organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c')
          OR (p_org_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c' AND dw.organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD')
          -- Handle Stoke org dev/prod mismatch
          OR (p_org_id = 'org_2yyo35c5YVUqjJ86qen45VfwwxD' AND dw.organization_id = 'org_2yycYh2ig5m8LwgONhJfZGYhkm9')
          OR (p_org_id = 'org_2yycYh2ig5m8LwgONhJfZGYhkm9' AND dw.organization_id = 'org_2yyo35c5YVUqjJ86qen45VfwwxD')
        )
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

COMMENT ON FUNCTION public.get_workflow_access_level IS 'Get workflow access level for an organization. Returns owner/admin/write/read/public_read or NULL. Handles dev/prod Clerk org ID mismatch.';
