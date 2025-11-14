-- Migration: Add TypeScript workflow format support
-- Created: 2025-02-08
-- Description: Extends preferred_format to support 'typescript' alongside 'yaml' and 'jsonb'

-- =============================================================================
-- Extend Format Support to Include TypeScript
-- =============================================================================

-- Drop existing constraints
ALTER TABLE public.deployed_workflows
DROP CONSTRAINT IF EXISTS deployed_workflows_preferred_format_check;

ALTER TABLE public.deployed_workflow_versions
DROP CONSTRAINT IF EXISTS deployed_workflow_versions_preferred_format_check;

-- Add new constraints with 'typescript' option
ALTER TABLE public.deployed_workflows
ADD CONSTRAINT deployed_workflows_preferred_format_check
CHECK (preferred_format IN ('jsonb', 'yaml', 'typescript'));

ALTER TABLE public.deployed_workflow_versions
ADD CONSTRAINT deployed_workflow_versions_preferred_format_check
CHECK (preferred_format IN ('jsonb', 'yaml', 'typescript'));

-- =============================================================================
-- Add TypeScript-Specific Columns
-- =============================================================================

-- Store TypeScript workflow metadata (AST-extracted)
ALTER TABLE public.deployed_workflows
ADD COLUMN IF NOT EXISTS typescript_metadata JSONB;

ALTER TABLE public.deployed_workflow_versions
ADD COLUMN IF NOT EXISTS typescript_metadata JSONB;

-- =============================================================================
-- Update View to Handle TypeScript Workflows
-- =============================================================================
CREATE OR REPLACE VIEW public.deployed_workflows_with_sequence AS
SELECT
    w.id, w.name, w.description, w.status, w.category,
    w.successful_runs, w.failed_runs, w.cancelled_runs, w.total_executions,
    w.estimated_duration_seconds, w.workflow_type, w.parent_workflow_id, w.display_order,
    w.created_by, w.created_at, w.updated_at,
    w.current_version_id, w.total_versions,

    -- YAML text (for YAML workflows)
    CASE
        WHEN v.automation_sequence_yaml IS NOT NULL AND v.automation_sequence_yaml != ''
        THEN v.automation_sequence_yaml
        ELSE NULL
    END as automation_sequence_yaml,

    -- JSONB (for legacy and TypeScript metadata)
    v.automation_sequence,

    -- TypeScript metadata (AST-extracted steps, inputs, conditions)
    v.typescript_metadata,

    -- Indicate which format is being used
    COALESCE(v.preferred_format, 'jsonb') as sequence_format,

    v.version_number as version,
    v.change_notes as current_version_notes
FROM public.deployed_workflows w
LEFT JOIN public.deployed_workflow_versions v ON w.current_version_id = v.id;

-- =============================================================================
-- Add Comments for Documentation
-- =============================================================================
COMMENT ON COLUMN public.deployed_workflows.typescript_metadata IS 'TypeScript workflow metadata: steps, inputs, conditions, types (extracted from AST)';
COMMENT ON COLUMN public.deployed_workflow_versions.typescript_metadata IS 'TypeScript workflow metadata for this version (AST-extracted)';

-- =============================================================================
-- Create Indexes for TypeScript Format Performance
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_typescript_format
ON public.deployed_workflows(preferred_format)
WHERE preferred_format = 'typescript';

CREATE INDEX IF NOT EXISTS idx_workflow_versions_typescript_format
ON public.deployed_workflow_versions(preferred_format)
WHERE preferred_format = 'typescript';

-- Create GIN index for TypeScript metadata queries
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_typescript_metadata
ON public.deployed_workflows USING GIN(typescript_metadata);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_typescript_metadata
ON public.deployed_workflow_versions USING GIN(typescript_metadata);

-- =============================================================================
-- Migration Safety Check
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE 'TypeScript workflow support added successfully';
    RAISE NOTICE 'Format options: jsonb (legacy), yaml (declarative), typescript (code-based)';
END $$;
