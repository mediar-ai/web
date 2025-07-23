-- Migration: Fix saved_workflow_syntheses id column to be auto-incrementing
-- Created: 2025-01-22
-- Description: Fixes the id column to be automatically generated

-- Create a sequence for the id column
CREATE SEQUENCE saved_workflow_syntheses_id_seq;

-- Set the sequence ownership to the id column
ALTER SEQUENCE saved_workflow_syntheses_id_seq OWNED BY saved_workflow_syntheses.id;

-- Set the default value for the id column to use the sequence
ALTER TABLE saved_workflow_syntheses ALTER COLUMN id SET DEFAULT nextval('saved_workflow_syntheses_id_seq');

-- Update the sequence to start from a higher value to avoid conflicts
SELECT setval('saved_workflow_syntheses_id_seq', COALESCE(MAX(id), 0) + 1, false) FROM saved_workflow_syntheses; 