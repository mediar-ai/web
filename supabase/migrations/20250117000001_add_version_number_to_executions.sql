-- Migration: Add version tracking to workflow executions
-- Created: 2025-01-17 
-- Description: Adds version_number column to track which workflow version was executed

-- Add version_number column to workflow_executions table
ALTER TABLE public.workflow_executions 
ADD COLUMN IF NOT EXISTS version_number text;

-- Create index for efficient version-based queries
CREATE INDEX IF NOT EXISTS idx_workflow_executions_version_number 
ON public.workflow_executions(version_number);

-- Create composite index for workflow_id + version_number queries 
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_version 
ON public.workflow_executions(workflow_id, version_number);

-- Add comment to document the column
COMMENT ON COLUMN public.workflow_executions.version_number 
IS 'Version number of the workflow that was executed (e.g., "1.0.63")'; 