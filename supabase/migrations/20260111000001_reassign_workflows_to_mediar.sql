-- Fix migration: Reassign workflows from old org ID to correct Mediar org
-- The org_2yydAO45WOB4RaCE4F4BNUPtw9c has 15 workflows but might not be the actual Mediar org
-- We need to move these to the correct Mediar org: org_2yynzGa53bNM1GTPLp5mc2lYRyD

-- First, reassign all workflows from the old org to the correct Mediar org
UPDATE public.deployed_workflows
SET organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'
WHERE organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c';

-- Also update the workflow_organization_access table
UPDATE public.workflow_organization_access
SET organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'
WHERE organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c';

-- Ensure Mediar org has admin access to all its workflows
INSERT INTO public.workflow_organization_access (workflow_id, organization_id, access_level)
SELECT
  dw.id,
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD',
  'admin'
FROM public.deployed_workflows dw
WHERE dw.organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'
AND NOT EXISTS (
  SELECT 1
  FROM public.workflow_organization_access woa
  WHERE woa.workflow_id = dw.id
  AND woa.organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'
)
ON CONFLICT (workflow_id, organization_id) DO NOTHING;

-- Log the changes
DO $$
DECLARE
  workflows_moved INTEGER;
  access_updated INTEGER;
BEGIN
  SELECT COUNT(*) INTO workflows_moved
  FROM deployed_workflows
  WHERE organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD';

  SELECT COUNT(*) INTO access_updated
  FROM workflow_organization_access
  WHERE organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD';

  RAISE NOTICE 'Migration complete: % workflows assigned to Mediar, % access records updated', workflows_moved, access_updated;
END $$;