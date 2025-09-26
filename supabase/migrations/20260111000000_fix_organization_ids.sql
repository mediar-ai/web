-- Fix migration: Populate organization_id for existing workflows
-- This migration assigns all existing workflows without organization_id to Mediar

-- First, update all workflows that don't have an organization_id
-- Assign them to the Mediar organization
UPDATE public.deployed_workflows
SET organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'
WHERE organization_id IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_organization_id
ON public.deployed_workflows(organization_id);

-- Also populate the workflow_organization_access table for existing workflows
-- This ensures Mediar has explicit access to all workflows
INSERT INTO public.workflow_organization_access (workflow_id, organization_id, access_level)
SELECT
  dw.id,
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD',
  'admin'
FROM public.deployed_workflows dw
WHERE NOT EXISTS (
  SELECT 1
  FROM public.workflow_organization_access woa
  WHERE woa.workflow_id = dw.id
  AND woa.organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'
)
ON CONFLICT (workflow_id, organization_id) DO NOTHING;

-- No need for second org - test123 should not have access