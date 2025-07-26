-- Migration: Fix synthesis_session_id data type mismatch
-- Created: 2025-01-30
-- Description: Changes synthesis_session_id columns from TEXT to bigint to match synthesis_sessions.id

-- First, drop the foreign key constraints that reference synthesis_sessions(id) as TEXT
ALTER TABLE public.raw_timeline_event_annotations 
DROP CONSTRAINT IF EXISTS raw_timeline_event_annotations_synthesis_session_id_fkey;

ALTER TABLE public.timeline_event_annotations 
DROP CONSTRAINT IF EXISTS timeline_event_annotations_synthesis_session_id_fkey;

-- Convert the TEXT synthesis_session_id columns to bigint
-- Handle any existing data by converting valid numeric strings to bigint, set NULL for invalid data
ALTER TABLE public.raw_timeline_event_annotations 
ALTER COLUMN synthesis_session_id TYPE bigint USING (
  CASE 
    WHEN synthesis_session_id ~ '^[0-9]+$' THEN synthesis_session_id::bigint
    ELSE NULL
  END
);

ALTER TABLE public.timeline_event_annotations 
ALTER COLUMN synthesis_session_id TYPE bigint USING (
  CASE 
    WHEN synthesis_session_id ~ '^[0-9]+$' THEN synthesis_session_id::bigint
    ELSE NULL
  END
);

-- Re-add the foreign key constraints with correct bigint type
ALTER TABLE public.raw_timeline_event_annotations 
ADD CONSTRAINT raw_timeline_event_annotations_synthesis_session_id_fkey 
FOREIGN KEY (synthesis_session_id) REFERENCES public.synthesis_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.timeline_event_annotations 
ADD CONSTRAINT timeline_event_annotations_synthesis_session_id_fkey 
FOREIGN KEY (synthesis_session_id) REFERENCES public.synthesis_sessions(id) ON DELETE CASCADE;

-- Update comments to reflect the corrected data type
COMMENT ON COLUMN public.raw_timeline_event_annotations.synthesis_session_id IS 'Links annotation to specific synthesis session (bigint) for proper reset behavior';
COMMENT ON COLUMN public.timeline_event_annotations.synthesis_session_id IS 'Links annotation to specific synthesis session (bigint) for proper reset behavior';

-- Recreate indexes with the new data type (drop and recreate for safety)
DROP INDEX IF EXISTS idx_raw_timeline_annotations_session;
DROP INDEX IF EXISTS idx_timeline_annotations_session;

CREATE INDEX idx_raw_timeline_annotations_session 
ON public.raw_timeline_event_annotations(synthesis_session_id) WHERE synthesis_session_id IS NOT NULL;

CREATE INDEX idx_timeline_annotations_session 
ON public.timeline_event_annotations(synthesis_session_id) WHERE synthesis_session_id IS NOT NULL; 