-- Assign workflows with NULL organization_id to the main Mediar organization
-- This helps with viewing all Mediar workflows when switching organizations

-- First, let's see what we're updating
DO $$
BEGIN
  RAISE NOTICE 'Workflows with NULL organization_id that will be updated: %',
    (SELECT COUNT(*) FROM public.deployed_workflows WHERE organization_id IS NULL);
END $$;

-- Update workflows with NULL organization_id to the main Mediar org
-- org_REDACTED is the current/main Mediar organization
UPDATE public.deployed_workflows
SET
  organization_id = 'org_REDACTED',
  updated_at = NOW()
WHERE organization_id IS NULL;

-- Also update any workflows that might have empty string as organization_id
UPDATE public.deployed_workflows
SET
  organization_id = 'org_REDACTED',
  updated_at = NOW()
WHERE organization_id = '';

-- Log the results
DO $$
DECLARE
  mediar_count INTEGER;
  legacy_count INTEGER;
  test_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO mediar_count
  FROM public.deployed_workflows
  WHERE organization_id = 'org_REDACTED';

  SELECT COUNT(*) INTO legacy_count
  FROM public.deployed_workflows
  WHERE organization_id = 'org_REDACTED';

  SELECT COUNT(*) INTO test_count
  FROM public.deployed_workflows
  WHERE organization_id = 'org_REDACTED';

  RAISE NOTICE 'Workflow distribution after migration:';
  RAISE NOTICE '  Mediar (main): % workflows', mediar_count;
  RAISE NOTICE '  Mediar (legacy): % workflows', legacy_count;
  RAISE NOTICE '  test123: % workflows', test_count;
END $$;