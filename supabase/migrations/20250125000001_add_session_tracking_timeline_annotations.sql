-- Migration: Add session tracking to timeline annotations
-- Created: 2025-01-25
-- Description: Add session/status tracking to timeline annotations to match workflow pattern

-- Add session tracking to raw_timeline_event_annotations
ALTER TABLE public.raw_timeline_event_annotations 
ADD COLUMN IF NOT EXISTS synthesis_session_id TEXT REFERENCES public.synthesis_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.raw_timeline_event_annotations 
ADD COLUMN IF NOT EXISTS annotation_status VARCHAR(20) DEFAULT 'draft';

ALTER TABLE public.raw_timeline_event_annotations 
ADD CONSTRAINT check_annotation_status 
CHECK (annotation_status IN ('draft', 'saved', 'archived'));

-- Add session tracking to timeline_event_annotations  
ALTER TABLE public.timeline_event_annotations 
ADD COLUMN IF NOT EXISTS synthesis_session_id TEXT REFERENCES public.synthesis_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.timeline_event_annotations 
ADD COLUMN IF NOT EXISTS annotation_status VARCHAR(20) DEFAULT 'draft';

ALTER TABLE public.timeline_event_annotations 
ADD CONSTRAINT check_timeline_annotation_status 
CHECK (annotation_status IN ('draft', 'saved', 'archived'));

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_raw_timeline_annotations_session 
ON public.raw_timeline_event_annotations(synthesis_session_id);

CREATE INDEX IF NOT EXISTS idx_raw_timeline_annotations_status 
ON public.raw_timeline_event_annotations(annotation_status);

CREATE INDEX IF NOT EXISTS idx_timeline_annotations_session 
ON public.timeline_event_annotations(synthesis_session_id);

CREATE INDEX IF NOT EXISTS idx_timeline_annotations_status 
ON public.timeline_event_annotations(annotation_status);

-- Add comments
COMMENT ON COLUMN public.raw_timeline_event_annotations.synthesis_session_id IS 'Links annotation to specific synthesis session for proper reset behavior';
COMMENT ON COLUMN public.raw_timeline_event_annotations.annotation_status IS 'Status: draft (current session), saved (finalized), archived (hidden)';
COMMENT ON COLUMN public.timeline_event_annotations.synthesis_session_id IS 'Links annotation to specific synthesis session for proper reset behavior';
COMMENT ON COLUMN public.timeline_event_annotations.annotation_status IS 'Status: draft (current session), saved (finalized), archived (hidden)';

-- Mark existing annotations as 'saved' to preserve them
UPDATE public.raw_timeline_event_annotations 
SET annotation_status = 'saved' 
WHERE annotation_status = 'draft';

UPDATE public.timeline_event_annotations 
SET annotation_status = 'saved' 
WHERE annotation_status = 'draft'; 