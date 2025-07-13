-- Migration: Add skip_next_cancellation_check flag for manual workflow resumption
-- Created: 2025-01-14
-- Description: Add flag to allow skipping cancellation check for the first execution after manual resume

-- Add the skip_next_cancellation_check column to deployed_workflows table
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS skip_next_cancellation_check boolean DEFAULT false;

-- Add comment to explain the column purpose
COMMENT ON COLUMN public.deployed_workflows.skip_next_cancellation_check IS 'Flag to skip cancellation check for next execution when workflow is manually resumed from paused state';

-- Create index for faster queries on this flag (since Modal will check it frequently)
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_skip_cancellation_check 
ON public.deployed_workflows(skip_next_cancellation_check) 
WHERE skip_next_cancellation_check = true; 