-- Migration: Fix check_org_workflow_access to include owner org
-- Created: 2025-11-26
-- Purpose: Allow access if org owns the workflow (organization_id) OR has explicit access via workflow_organization_access

-- Fix the function to also check the workflow's own organization_id
CREATE OR REPLACE FUNCTION check_org_workflow_access(
  p_org_id TEXT,
  p_workflow_uuid UUID
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    -- Check 1: Workflow belongs to this organization (owner access)
    SELECT 1
    FROM deployed_workflows dw
    WHERE dw.uuid = p_workflow_uuid
      AND dw.organization_id = p_org_id
      AND dw.status = 'deployed'

    UNION

    -- Check 2: Organization has explicit access via workflow_organization_access table
    SELECT 1
    FROM workflow_organization_access woa
    JOIN deployed_workflows dw ON dw.uuid = woa.workflow_uuid
    WHERE woa.organization_id = p_org_id
      AND dw.uuid = p_workflow_uuid
      AND dw.status = 'deployed'
  );
$$ LANGUAGE sql SECURITY DEFINER;

COMMENT ON FUNCTION check_org_workflow_access IS 'Verify if an organization has access to a specific workflow UUID (owner or explicit access)';
