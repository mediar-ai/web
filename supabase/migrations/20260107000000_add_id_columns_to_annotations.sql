-- Add ID columns to timeline_event_annotations for proper ID-based relationships
-- This enables the hybrid approach: keep text fields but add ID references

-- Add new ID columns (nullable for migration compatibility)
ALTER TABLE "public"."timeline_event_annotations" 
ADD COLUMN IF NOT EXISTS "workflow_type_id" bigint,
ADD COLUMN IF NOT EXISTS "workflow_instance_id" bigint,
ADD COLUMN IF NOT EXISTS "workflow_step_id" bigint,
ADD COLUMN IF NOT EXISTS "workflow_substep_id" bigint;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS "idx_timeline_annotations_workflow_type_id" ON "public"."timeline_event_annotations" ("workflow_type_id");
CREATE INDEX IF NOT EXISTS "idx_timeline_annotations_workflow_instance_id" ON "public"."timeline_event_annotations" ("workflow_instance_id");
CREATE INDEX IF NOT EXISTS "idx_timeline_annotations_workflow_step_id" ON "public"."timeline_event_annotations" ("workflow_step_id");
CREATE INDEX IF NOT EXISTS "idx_timeline_annotations_workflow_substep_id" ON "public"."timeline_event_annotations" ("workflow_substep_id");

-- Add comments to document the new columns
COMMENT ON COLUMN "public"."timeline_event_annotations"."workflow_type_id" IS 'ID reference to workflow type (stored in detailed_workflow_data)';
COMMENT ON COLUMN "public"."timeline_event_annotations"."workflow_instance_id" IS 'ID reference to workflow instance (stored in detailed_workflow_data)';
COMMENT ON COLUMN "public"."timeline_event_annotations"."workflow_step_id" IS 'ID reference to workflow step (stored in detailed_workflow_data)';
COMMENT ON COLUMN "public"."timeline_event_annotations"."workflow_substep_id" IS 'ID reference to workflow substep (stored in detailed_workflow_data)'; 