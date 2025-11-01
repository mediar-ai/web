-- Migration: Update search_vector priority distribution
-- Description: Distribute priority evenly across fields in order: app_name > window_title > step_name > element_path > workflow_name > definition
-- Created: 2025-01-16
-- Author: AI Assistant

-- Drop the old generated column
ALTER TABLE rpa_knowledgebase 
DROP COLUMN search_vector;

-- Recreate with new priority distribution
-- PostgreSQL weights: A (1.0) > B (0.4) > C (0.2) > D (0.1)
-- Using all 4 levels for even distribution across 6 fields
ALTER TABLE rpa_knowledgebase
ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', COALESCE(app_name, '')), 'A') ||        -- Priority 1: 1.0
  setweight(to_tsvector('english', COALESCE(window_title, '')), 'A') ||    -- Priority 2: 1.0
  setweight(to_tsvector('english', COALESCE(step_name, '')), 'B') ||       -- Priority 3: 0.4
  setweight(to_tsvector('english', COALESCE(element_path, '')), 'B') ||    -- Priority 4: 0.4
  setweight(to_tsvector('english', COALESCE(workflow_name, '')), 'C') ||   -- Priority 5: 0.2
  setweight(to_tsvector('english', COALESCE(definition, '')), 'D')         -- Priority 6: 0.1
) STORED;

-- Recreate the GIN index
CREATE INDEX idx_rpa_kb_search_vector ON rpa_knowledgebase USING GIN(search_vector);

-- Add comment
COMMENT ON COLUMN rpa_knowledgebase.search_vector IS 'Full-text search with priority: app_name (A) > window_title (A) > step_name (B) > element_path (B) > workflow_name (C) > definition (D)';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE 'Search vector priority updated successfully!';
  RAISE NOTICE 'Priority order: app_name (A=1.0) > window_title (A=1.0) > step_name (B=0.4) > element_path (B=0.4) > workflow_name (C=0.2) > definition (D=0.1)';
END $$;

