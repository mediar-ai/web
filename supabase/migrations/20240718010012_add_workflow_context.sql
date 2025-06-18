-- Add a new column to store structured context about the workflow session.
ALTER TABLE public.low_level_workflows
ADD COLUMN workflow_context JSONB; 