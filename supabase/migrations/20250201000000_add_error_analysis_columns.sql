-- Migration: Add error analysis columns to workflow_executions
-- Created: 2025-02-01
-- Description: Adds columns for storing AI-generated error analysis using Gemini Vertex AI

-- Add error_analysis column to store AI-generated error diagnosis
ALTER TABLE public.workflow_executions
ADD COLUMN IF NOT EXISTS error_analysis text;

-- Add error_analyzed_at column to track when the analysis was performed
ALTER TABLE public.workflow_executions
ADD COLUMN IF NOT EXISTS error_analyzed_at timestamp with time zone;

-- Add index on error_analyzed_at for efficient querying of analyzed errors
CREATE INDEX IF NOT EXISTS idx_workflow_executions_error_analyzed_at
ON public.workflow_executions(error_analyzed_at)
WHERE error_analyzed_at IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN public.workflow_executions.error_analysis IS 'AI-generated error diagnosis and troubleshooting steps from Gemini Vertex AI';
COMMENT ON COLUMN public.workflow_executions.error_analyzed_at IS 'Timestamp when error analysis was performed';