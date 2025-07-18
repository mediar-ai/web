-- Migration: Add YAML columns for dual-format sequence storage
-- Created: 2025-01-15
-- Description: Adds YAML text columns alongside existing JSONB columns for gradual transition

-- =============================================================================
-- Add YAML Column to Main Workflows Table
-- =============================================================================
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS automation_sequence_yaml TEXT;

-- Add format tracking column
ALTER TABLE public.deployed_workflows 
ADD COLUMN IF NOT EXISTS preferred_format VARCHAR(10) DEFAULT 'jsonb' 
CHECK (preferred_format IN ('jsonb', 'yaml'));

-- =============================================================================
-- Add YAML Column to Versions Table  
-- =============================================================================
ALTER TABLE public.deployed_workflow_versions 
ADD COLUMN IF NOT EXISTS automation_sequence_yaml TEXT;

ALTER TABLE public.deployed_workflow_versions 
ADD COLUMN IF NOT EXISTS preferred_format VARCHAR(10) DEFAULT 'jsonb'
CHECK (preferred_format IN ('jsonb', 'yaml'));

-- =============================================================================
-- Update Compatibility View for YAML Priority
-- =============================================================================
CREATE OR REPLACE VIEW public.deployed_workflows_with_sequence AS
SELECT 
    w.id, w.name, w.description, w.status, w.category,
    w.successful_runs, w.failed_runs, w.cancelled_runs, w.total_executions,
    w.estimated_duration_seconds, w.workflow_type, w.parent_workflow_id, w.display_order,
    w.created_by, w.created_at, w.updated_at,
    w.current_version_id, w.total_versions,
    
    -- YAML priority: Use YAML if available, fallback to JSONB
    CASE 
        WHEN v.automation_sequence_yaml IS NOT NULL AND v.automation_sequence_yaml != '' 
        THEN v.automation_sequence_yaml
        ELSE NULL
    END as automation_sequence_yaml,
    
    -- Keep JSONB for backward compatibility
    v.automation_sequence,
    
    -- Indicate which format is being used
    CASE 
        WHEN v.automation_sequence_yaml IS NOT NULL AND v.automation_sequence_yaml != '' 
        THEN 'yaml'
        ELSE 'jsonb' 
    END as sequence_format,
    
    v.version_number as version,
    v.change_notes as current_version_notes
FROM public.deployed_workflows w
LEFT JOIN public.deployed_workflow_versions v ON w.current_version_id = v.id;

-- =============================================================================
-- Add Comments for Documentation
-- =============================================================================
COMMENT ON COLUMN public.deployed_workflows.automation_sequence_yaml IS 'Workflow sequence in YAML format (human-readable, version-control friendly)';
COMMENT ON COLUMN public.deployed_workflows.preferred_format IS 'Preferred storage format: jsonb (legacy) or yaml (new)';
COMMENT ON COLUMN public.deployed_workflow_versions.automation_sequence_yaml IS 'Workflow sequence in YAML format for this version';
COMMENT ON COLUMN public.deployed_workflow_versions.preferred_format IS 'Storage format used for this version';

-- =============================================================================
-- Create Index for YAML Column Performance
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_yaml_format 
ON public.deployed_workflows(preferred_format) 
WHERE automation_sequence_yaml IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_versions_yaml_format 
ON public.deployed_workflow_versions(preferred_format) 
WHERE automation_sequence_yaml IS NOT NULL;

-- =============================================================================
-- Migration Safety Check
-- =============================================================================
-- Ensure no existing workflows are broken by this migration
DO $$
BEGIN
    -- Count existing workflows to ensure they still work
    DECLARE
        existing_count INTEGER;
        accessible_count INTEGER;
    BEGIN
        SELECT COUNT(*) INTO existing_count FROM public.deployed_workflows;
        SELECT COUNT(*) INTO accessible_count FROM public.deployed_workflows_with_sequence 
        WHERE automation_sequence IS NOT NULL OR automation_sequence_yaml IS NOT NULL;
        
        IF existing_count != accessible_count THEN
            RAISE EXCEPTION 'Migration failed: % existing workflows but only % accessible after migration', 
                existing_count, accessible_count;
        END IF;
        
        RAISE NOTICE 'Migration successful: % workflows remain accessible', accessible_count;
    END;
END $$; 