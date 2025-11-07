-- Migration: Rename is_shared to is_public and migrate NULL org_id workflows
-- Created: 2026-02-01
-- Description: 
--   1. Rename is_shared -> is_public for clearer semantics
--   2. Migrate workflows with NULL organization_id to Mediar org
--   3. Ensure all workflows have proper organization ownership

-- Step 1: Rename column for clearer semantics
-- is_shared was confusing (shared WITH who? requires NULL org_id)
-- is_public is clear (publicly accessible to everyone)
ALTER TABLE public.deployed_workflows
RENAME COLUMN is_shared TO is_public;

-- Step 2: Update comment for clarity
COMMENT ON COLUMN public.deployed_workflows.is_public IS 
  'Whether this workflow is publicly accessible to all organizations (everyone can view/execute)';

-- Step 3: Migrate workflows with NULL organization_id to Mediar main org
-- These are orphaned workflows that need a proper owner
UPDATE public.deployed_workflows
SET 
  organization_id = 'org_REDACTED', -- Mediar main org
  updated_at = NOW()
WHERE organization_id IS NULL;

-- Step 4: Ensure all migrated workflows have access entries
-- This grants the owner organization admin access
INSERT INTO public.workflow_organization_access (
  workflow_id, 
  organization_id, 
  access_level,
  granted_at
)
SELECT 
  id,
  'org_REDACTED',
  'admin',
  NOW()
FROM public.deployed_workflows
WHERE organization_id = 'org_REDACTED'
ON CONFLICT (workflow_id, organization_id) DO NOTHING;

-- Step 5: Log the migration results
DO $$
DECLARE
  public_count INTEGER;
  mediar_count INTEGER;
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO public_count
  FROM public.deployed_workflows
  WHERE is_public = true;

  SELECT COUNT(*) INTO mediar_count
  FROM public.deployed_workflows
  WHERE organization_id = 'org_REDACTED';

  SELECT COUNT(*) INTO total_count
  FROM public.deployed_workflows;

  RAISE NOTICE 'Migration completed:';
  RAISE NOTICE '  Total workflows: %', total_count;
  RAISE NOTICE '  Public workflows (is_public=true): %', public_count;
  RAISE NOTICE '  Mediar-owned workflows: %', mediar_count;
  RAISE NOTICE '  Column renamed: is_shared -> is_public';
END $$;

