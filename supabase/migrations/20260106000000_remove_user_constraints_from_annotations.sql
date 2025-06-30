-- Remove user-related constraints from timeline_event_annotations
-- We don't use the users table or auth system for timeline annotations

-- Drop foreign key constraint to auth.users
ALTER TABLE "public"."timeline_event_annotations"
DROP CONSTRAINT IF EXISTS "timeline_event_annotations_user_id_fkey";

-- Disable Row Level Security since we don't use auth.uid()
ALTER TABLE "public"."timeline_event_annotations" DISABLE ROW LEVEL SECURITY; 