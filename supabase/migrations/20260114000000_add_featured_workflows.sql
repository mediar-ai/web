-- Migration: Add featured workflows support
-- Created: 2026-01-14
-- Description: Adds is_featured column to deployed_workflows for demo/mandatory workflows
--              that always appear in users' workflow lists regardless of organization

-- Add is_featured column
ALTER TABLE deployed_workflows
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

-- Partial index for efficient querying (only indexes featured workflows)
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_is_featured
ON deployed_workflows(is_featured) WHERE is_featured = true;

-- Comment for documentation
COMMENT ON COLUMN deployed_workflows.is_featured IS
  'Featured/demo workflows that appear for all users regardless of organization. These are mandatory onboarding or essential workflows.';

-- Mark the "Enable Mediar Terminator Extension" workflow as featured
UPDATE deployed_workflows
SET is_featured = true
WHERE uuid = '593a77b5-9245-46bc-90c9-5f49f257851f';
