-- Migration: Add updated_at column to deployed_workflow_versions
-- Created: 2026-01-15
-- Description: Adds missing updated_at column and trigger for version tracking

-- Add updated_at column if it doesn't exist
ALTER TABLE public.deployed_workflow_versions
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Create trigger to auto-update updated_at on row updates
CREATE TRIGGER update_deployed_workflow_versions_updated_at
    BEFORE UPDATE ON public.deployed_workflow_versions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN public.deployed_workflow_versions.updated_at IS 'Timestamp of last update to this version record';
