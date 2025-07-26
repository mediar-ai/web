-- Drop legacy timeline_event_annotations table and related objects
-- This table has been replaced by raw_timeline_event_annotations for granular event mapping

-- Drop indexes first to avoid dependency issues
DROP INDEX IF EXISTS "idx_timeline_event_annotations_event_id";
DROP INDEX IF EXISTS "idx_timeline_event_annotations_analysis_id";
DROP INDEX IF EXISTS "idx_timeline_event_annotations_user_id";
DROP INDEX IF EXISTS "idx_timeline_event_annotations_workflow_id";
DROP INDEX IF EXISTS "idx_timeline_annotations_workflow_type_id";
DROP INDEX IF EXISTS "idx_timeline_annotations_workflow_instance_id";
DROP INDEX IF EXISTS "idx_timeline_annotations_workflow_step_id";
DROP INDEX IF EXISTS "idx_timeline_annotations_workflow_substep_id";
DROP INDEX IF EXISTS "idx_timeline_annotations_step_id";
DROP INDEX IF EXISTS "idx_timeline_annotations_substep_id";

-- Drop views that depend on the table
DROP VIEW IF EXISTS "timeline_annotations_with_analysis";

-- Drop the main table with CASCADE to handle remaining constraints
DROP TABLE IF EXISTS "public"."timeline_event_annotations";

-- Legacy timeline_event_annotations table and related objects have been removed
-- This system has been replaced by raw_timeline_event_annotations for granular event mapping 