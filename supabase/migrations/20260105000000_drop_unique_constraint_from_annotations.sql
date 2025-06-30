-- Drop the unique constraint that prevents multiple workflow mappings per event
-- This allows one timeline event to be mapped to multiple workflows, which is the correct behavior
ALTER TABLE "public"."timeline_event_annotations"
DROP CONSTRAINT IF EXISTS "timeline_event_annotations_timeline_event_id_key"; 