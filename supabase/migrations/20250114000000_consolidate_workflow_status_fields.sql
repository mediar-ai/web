-- Migration: Consolidate workflow status fields
-- Created: 2025-01-14
-- Description: Merge 'status' and 'deployment_status' into single 'status' field for cleaner workflow state management

-- Step 1: Add the new consolidated status column
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS new_status text;

-- Step 2: Migrate existing data to the new consolidated status
-- Logic: deployment_status takes precedence since it represents the actual deployment state
UPDATE public.deployed_workflows 
SET new_status = CASE 
    -- If deployed and active -> 'deployed' (executable)
    WHEN deployment_status = 'deployed' AND status = 'active' THEN 'deployed'
    
    -- If deployed but inactive -> 'paused' (deployed but stopped)
    WHEN deployment_status = 'deployed' AND status = 'inactive' THEN 'paused'
    WHEN deployment_status = 'deployed' AND status = 'draft' THEN 'paused'
    WHEN deployment_status = 'deployed' AND status = 'deprecated' THEN 'paused'
    
    -- If deployment failed -> 'failed'
    WHEN deployment_status = 'failed' THEN 'failed'
    
    -- If deployment pending -> 'pending'
    WHEN deployment_status = 'pending' THEN 'pending'
    
    -- If deployment updating -> 'pending' (transition state)
    WHEN deployment_status = 'updating' THEN 'pending'
    
    -- Default fallback (shouldn't happen with valid data)
    ELSE 'draft'
END;

-- Step 3: Add constraint for valid status values
ALTER TABLE public.deployed_workflows 
ADD CONSTRAINT check_consolidated_status 
CHECK (new_status IN ('draft', 'pending', 'deployed', 'paused', 'failed', 'inactive'));

-- Step 4: Update the policy that depends on status column before dropping it
-- Drop the old policy that references status = 'active'
DROP POLICY IF EXISTS "Users can read active workflows" ON public.deployed_workflows;

-- Create new policy that references the consolidated status
-- 'deployed' status means the workflow is both deployed and active (executable)
CREATE POLICY "Users can read deployed workflows" 
ON public.deployed_workflows FOR SELECT 
USING (new_status = 'deployed'::text);

-- Step 5: Drop old columns
ALTER TABLE public.deployed_workflows 
DROP COLUMN IF EXISTS status,
DROP COLUMN IF EXISTS deployment_status;

-- Step 6: Rename new_status to status
ALTER TABLE public.deployed_workflows 
RENAME COLUMN new_status TO status;

-- Step 7: Update the policy to reference the renamed column
DROP POLICY IF EXISTS "Users can read deployed workflows" ON public.deployed_workflows;
CREATE POLICY "Users can read deployed workflows" 
ON public.deployed_workflows FOR SELECT 
USING (status = 'deployed'::text);

-- Add comment for documentation
COMMENT ON COLUMN public.deployed_workflows.status IS 
'Consolidated workflow status: draft (being built), pending (ready for deployment), deployed (active and executable), paused (deployed but stopped), failed (deployment failed), inactive (permanently disabled)'; 