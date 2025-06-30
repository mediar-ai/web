-- Switch timeline_event_annotations from complex timeline_event_id to simple analysis_id
-- This eliminates the need for complex session/timestamp matching

-- Step 1: Drop existing foreign key constraint to low_level_events
ALTER TABLE "public"."timeline_event_annotations"
DROP CONSTRAINT IF EXISTS "timeline_event_annotations_timeline_event_id_fkey";

-- Step 2: Rename the column from timeline_event_id to analysis_id
ALTER TABLE "public"."timeline_event_annotations"
RENAME COLUMN "timeline_event_id" TO "analysis_id";

-- Step 3: Update the column comment
COMMENT ON COLUMN "public"."timeline_event_annotations"."analysis_id" IS 'Foreign key to low_level_workflow_analyses.id - the analysis this annotation refers to';

-- Step 4: Add new foreign key constraint to low_level_workflow_analyses
ALTER TABLE "public"."timeline_event_annotations"
ADD CONSTRAINT "timeline_event_annotations_analysis_id_fkey"
FOREIGN KEY (analysis_id) REFERENCES public.low_level_workflow_analyses(id) ON DELETE CASCADE;

-- Step 5: Update indexes
DROP INDEX IF EXISTS "idx_timeline_event_annotations_event_id";
CREATE INDEX "idx_timeline_event_annotations_analysis_id" ON "public"."timeline_event_annotations" ("analysis_id");

-- Step 6: Add a helpful view for debugging the new structure
CREATE OR REPLACE VIEW timeline_annotations_with_analysis AS
SELECT 
  ta.*,
  a.client_timestamp as analysis_timestamp,
  a.llm_structured_output->>'step_title' as analysis_step_title,
  a.llm_structured_output->>'user_intent' as analysis_user_intent,
  a.window_title as analysis_window_title
FROM timeline_event_annotations ta
JOIN low_level_workflow_analyses a ON ta.analysis_id = a.id;

COMMENT ON VIEW timeline_annotations_with_analysis IS 'Helpful view showing timeline annotations with their linked analysis data'; 