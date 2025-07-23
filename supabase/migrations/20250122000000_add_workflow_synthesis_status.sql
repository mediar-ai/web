-- Migration: Add workflow synthesis status tracking
-- Created: 2025-01-22
-- Description: Adds status field to track draft vs saved workflow syntheses

-- Add status column
ALTER TABLE public.low_level_workflows 
ADD COLUMN IF NOT EXISTS synthesis_status VARCHAR(20) DEFAULT 'draft';

-- Add check constraint
ALTER TABLE public.low_level_workflows 
ADD CONSTRAINT check_synthesis_status 
CHECK (synthesis_status IN ('draft', 'saved', 'archived'));

-- Add saved timestamp
ALTER TABLE public.low_level_workflows 
ADD COLUMN IF NOT EXISTS saved_at TIMESTAMPTZ;

-- Add saved by user
ALTER TABLE public.low_level_workflows 
ADD COLUMN IF NOT EXISTS saved_by_user_id UUID;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_low_level_workflows_synthesis_status 
ON public.low_level_workflows(synthesis_status);

CREATE INDEX IF NOT EXISTS idx_low_level_workflows_user_status 
ON public.low_level_workflows(user_id, synthesis_status);

-- Add comments
COMMENT ON COLUMN public.low_level_workflows.synthesis_status IS 'Status of workflow synthesis: draft (in progress), saved (finalized), archived (hidden)';
COMMENT ON COLUMN public.low_level_workflows.saved_at IS 'Timestamp when workflow synthesis was saved/finalized';
COMMENT ON COLUMN public.low_level_workflows.saved_by_user_id IS 'User who saved the synthesis (may differ from creator in team scenarios)';

-- Update existing workflows to be saved
UPDATE public.low_level_workflows 
SET synthesis_status = 'saved', saved_at = created_at, saved_by_user_id = user_id
WHERE detailed_workflow_data IS NOT NULL; 