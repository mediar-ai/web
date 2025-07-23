-- Migration: Add workflow-specific columns to raw_timeline_event_annotations table
-- This enables detailed workflow mapping with structured data storage

-- Add workflow-specific columns
ALTER TABLE raw_timeline_event_annotations ADD COLUMN workflow_type TEXT;
ALTER TABLE raw_timeline_event_annotations ADD COLUMN workflow_instance TEXT;
ALTER TABLE raw_timeline_event_annotations ADD COLUMN workflow_step TEXT;
ALTER TABLE raw_timeline_event_annotations ADD COLUMN workflow_substep TEXT;
ALTER TABLE raw_timeline_event_annotations ADD COLUMN inputs TEXT;
ALTER TABLE raw_timeline_event_annotations ADD COLUMN outputs TEXT;

-- Add comments for documentation
COMMENT ON COLUMN raw_timeline_event_annotations.workflow_type IS 'Type of workflow this event belongs to';
COMMENT ON COLUMN raw_timeline_event_annotations.workflow_instance IS 'Specific instance/name of the workflow';
COMMENT ON COLUMN raw_timeline_event_annotations.workflow_step IS 'Main workflow step this event represents';
COMMENT ON COLUMN raw_timeline_event_annotations.workflow_substep IS 'Sub-step within the main workflow step';
COMMENT ON COLUMN raw_timeline_event_annotations.inputs IS 'Inputs/data going into this workflow step';
COMMENT ON COLUMN raw_timeline_event_annotations.outputs IS 'Outputs/results from this workflow step';

-- Create index on workflow columns for better query performance
CREATE INDEX idx_timeline_annotations_workflow_type ON raw_timeline_event_annotations(workflow_type);
CREATE INDEX idx_timeline_annotations_workflow_step ON raw_timeline_event_annotations(workflow_step);
CREATE INDEX idx_timeline_annotations_confidence ON raw_timeline_event_annotations(confidence_score); 