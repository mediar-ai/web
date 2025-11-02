-- Migration: Allow nullable/blank fields in rpa_knowledgebase
-- Description: Remove NOT NULL constraints from fields that can be blank
-- Only definition is truly required
-- Created: 2025-01-16

-- Update columns to allow NULL (remove NOT NULL constraint)
ALTER TABLE rpa_knowledgebase ALTER COLUMN app_name DROP NOT NULL;
ALTER TABLE rpa_knowledgebase ALTER COLUMN window_title DROP NOT NULL;
ALTER TABLE rpa_knowledgebase ALTER COLUMN element_path DROP NOT NULL;
ALTER TABLE rpa_knowledgebase ALTER COLUMN step_name DROP NOT NULL;
ALTER TABLE rpa_knowledgebase ALTER COLUMN workflow_name DROP NOT NULL;

-- Add comments explaining nullable fields
COMMENT ON COLUMN rpa_knowledgebase.app_name IS 'Application name (can be NULL/blank if unknown)';
COMMENT ON COLUMN rpa_knowledgebase.window_title IS 'Window title (can be NULL/blank if unknown)';
COMMENT ON COLUMN rpa_knowledgebase.element_path IS 'Element path (can be NULL/blank if unknown)';
COMMENT ON COLUMN rpa_knowledgebase.step_name IS 'Step name (can be NULL/blank if not provided)';
COMMENT ON COLUMN rpa_knowledgebase.workflow_name IS 'Workflow name (can be NULL/blank if not provided)';
COMMENT ON COLUMN rpa_knowledgebase.definition IS 'Step definition code (REQUIRED - used for duplicate detection)';

-- Add unique index for deduplication based on app_name, element_path, definition
-- NULL values are treated as distinct in unique indexes, but we want them to match
-- So we use COALESCE to convert NULL to empty string for matching
CREATE UNIQUE INDEX idx_rpa_kb_unique_step ON rpa_knowledgebase (
  COALESCE(app_name, ''),
  COALESCE(element_path, ''),
  COALESCE(definition, '')
);

COMMENT ON INDEX idx_rpa_kb_unique_step IS 'Ensures unique steps based on app_name + element_path + definition (blank values match)';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Migration completed: Fields now nullable, unique constraint added';
  RAISE NOTICE 'Duplicate detection on: app_name (nullable) + element_path (nullable) + definition (required)';
END $$;

