-- Migration: Add functions for secure workflow download
-- Created: 2025-11-22
-- Purpose: Support download route authentication and metadata retrieval

-- Function: Check if organization has access to workflow
CREATE OR REPLACE FUNCTION check_org_workflow_access(
  p_org_id TEXT,
  p_workflow_uuid UUID
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workflow_organization_access woa
    JOIN deployed_workflows dw ON dw.uuid = woa.workflow_uuid
    WHERE woa.organization_id = p_org_id
      AND dw.uuid = p_workflow_uuid
      AND dw.status = 'deployed'
  );
$$ LANGUAGE sql SECURITY DEFINER;

COMMENT ON FUNCTION check_org_workflow_access IS 'Verify if an organization has access to a specific workflow UUID';

-- Function: Get workflow download metadata
CREATE OR REPLACE FUNCTION get_workflow_download_metadata(
  p_workflow_uuid UUID
) RETURNS TABLE (
  uuid UUID,
  name TEXT,
  github_release_url TEXT,
  github_release_checksum TEXT,
  package_json_version TEXT,
  preferred_format TEXT
) AS $$
  SELECT 
    uuid,
    name,
    github_release_url,
    github_release_checksum,
    package_json_version,
    preferred_format
  FROM deployed_workflows
  WHERE uuid = p_workflow_uuid
    AND status = 'deployed';
$$ LANGUAGE sql SECURITY DEFINER;

COMMENT ON FUNCTION get_workflow_download_metadata IS 'Get download metadata for a workflow by UUID (requires status=deployed)';

-- Function: Get workflow by UUID with org access check
CREATE OR REPLACE FUNCTION get_workflow_for_execution(
  p_org_id TEXT,
  p_workflow_uuid UUID
) RETURNS TABLE (
  uuid UUID,
  name TEXT,
  github_release_url TEXT,
  github_release_checksum TEXT,
  package_json_version TEXT,
  preferred_format TEXT,
  requires_files BOOLEAN
) AS $$
  SELECT 
    dw.uuid,
    dw.name,
    dw.github_release_url,
    dw.github_release_checksum,
    dw.package_json_version,
    dw.preferred_format,
    dw.requires_files
  FROM deployed_workflows dw
  JOIN workflow_organization_access woa ON woa.workflow_uuid = dw.uuid
  WHERE woa.organization_id = p_org_id
    AND dw.uuid = p_workflow_uuid
    AND dw.status = 'deployed'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

COMMENT ON FUNCTION get_workflow_for_execution IS 'Get workflow metadata for execution with org access validation';
