-- Migration: Add workflow type and parent relationship for settings workflows
-- Created: 2025-01-17
-- Description: Enables settings workflows to be nested under execution workflows

-- Add workflow_type and parent_workflow_id columns
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS workflow_type text NOT NULL DEFAULT 'execution' 
    CHECK (workflow_type IN ('execution', 'settings')),
ADD COLUMN IF NOT EXISTS parent_workflow_id bigint 
    REFERENCES public.deployed_workflows(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_parent ON public.deployed_workflows(parent_workflow_id);
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_type ON public.deployed_workflows(workflow_type);
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_type_parent ON public.deployed_workflows(workflow_type, parent_workflow_id);

-- Add comments for documentation
COMMENT ON COLUMN public.deployed_workflows.workflow_type IS 'Type of workflow: execution (runnable) or settings (configuration template)';
COMMENT ON COLUMN public.deployed_workflows.parent_workflow_id IS 'Reference to parent execution workflow (for settings workflows only)';
COMMENT ON COLUMN public.deployed_workflows.display_order IS 'Order for displaying settings workflows within parent (0 = first)';

-- Constraint: settings workflows must have a parent, execution workflows cannot have a parent
ALTER TABLE public.deployed_workflows 
ADD CONSTRAINT check_settings_parent 
CHECK (
    (workflow_type = 'settings' AND parent_workflow_id IS NOT NULL) OR 
    (workflow_type = 'execution' AND parent_workflow_id IS NULL)
);

-- Update existing workflows to be execution type (they're all currently execution workflows)
UPDATE public.deployed_workflows 
SET workflow_type = 'execution' 
WHERE workflow_type IS NULL; 