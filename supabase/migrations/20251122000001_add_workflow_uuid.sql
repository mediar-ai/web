-- Migration: Add UUID and GitHub release fields to deployed_workflows
-- Created: 2025-11-22
-- Purpose: Enable UUID-based workflow storage and GitHub release downloads

-- Add UUID column (will be used as folder name in C:\Workflows\{uuid}\)
ALTER TABLE deployed_workflows
ADD COLUMN uuid UUID DEFAULT gen_random_uuid() NOT NULL;

-- Add unique constraint
ALTER TABLE deployed_workflows
ADD CONSTRAINT unique_workflow_uuid UNIQUE (uuid);

-- Create index for fast UUID lookups
CREATE INDEX idx_deployed_workflows_uuid ON deployed_workflows(uuid);

-- Add GitHub release metadata columns
ALTER TABLE deployed_workflows
ADD COLUMN github_repo_url TEXT,
ADD COLUMN github_release_url TEXT,
ADD COLUMN github_release_checksum TEXT,
ADD COLUMN package_json_version TEXT;

-- Add comments for documentation
COMMENT ON COLUMN deployed_workflows.uuid IS 'Workflow UUID - used as folder name in C:\Workflows\{uuid}\ on VMs';
COMMENT ON COLUMN deployed_workflows.github_repo_url IS 'Standalone GitHub repository URL (for new workflows, replaces mono-repo github_path)';
COMMENT ON COLUMN deployed_workflows.github_release_url IS 'Direct download URL for pre-built workflow zip from GitHub releases';
COMMENT ON COLUMN deployed_workflows.github_release_checksum IS 'SHA256 checksum of release zip for integrity verification';
COMMENT ON COLUMN deployed_workflows.package_json_version IS 'Semantic version from package.json (source of truth for TypeScript workflows)';

-- Backfill UUIDs for existing workflows (gen_random_uuid already handles this via DEFAULT)
-- Verify all rows have UUIDs
DO $$
DECLARE
  missing_count INT;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM deployed_workflows
  WHERE uuid IS NULL;
  
  IF missing_count > 0 THEN
    RAISE NOTICE 'Found % workflows without UUIDs, generating...', missing_count;
    
    UPDATE deployed_workflows
    SET uuid = gen_random_uuid()
    WHERE uuid IS NULL;
    
    RAISE NOTICE 'UUIDs generated successfully';
  ELSE
    RAISE NOTICE 'All workflows already have UUIDs (% total)', (SELECT COUNT(*) FROM deployed_workflows);
  END IF;
END $$;
