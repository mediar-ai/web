-- Migration: Fix get_workflow_access_level to allow owners to access workflows in any status
-- Created: 2025-12-10
-- Purpose: Owners should be able to access their own workflows regardless of status (draft, deployed, etc.)
-- The status check only makes sense for shared/public workflows.

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
