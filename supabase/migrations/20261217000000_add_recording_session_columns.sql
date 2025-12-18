-- Add columns to session_metadata for recording session tracking
-- These columns support the desktop app's recording → processing → synthesis flow

-- Add stopped flag and timestamp
ALTER TABLE public.session_metadata
ADD COLUMN IF NOT EXISTS stopped BOOLEAN DEFAULT FALSE;

ALTER TABLE public.session_metadata
ADD COLUMN IF NOT EXISTS stopped_at TIMESTAMPTZ;

-- Add synthesis tracking columns
ALTER TABLE public.session_metadata
ADD COLUMN IF NOT EXISTS synthesizing BOOLEAN DEFAULT FALSE;

ALTER TABLE public.session_metadata
ADD COLUMN IF NOT EXISTS synthesis_complete BOOLEAN DEFAULT FALSE;

-- Add index for querying active recording sessions
CREATE INDEX IF NOT EXISTS idx_session_metadata_stopped
ON public.session_metadata(stopped)
WHERE stopped = FALSE;

-- Add index for querying sessions ready for synthesis
CREATE INDEX IF NOT EXISTS idx_session_metadata_synthesis_status
ON public.session_metadata(stopped, synthesis_complete)
WHERE stopped = TRUE AND synthesis_complete = FALSE;

COMMENT ON COLUMN public.session_metadata.stopped IS 'Whether recording has been stopped by user';
COMMENT ON COLUMN public.session_metadata.stopped_at IS 'Timestamp when recording was stopped';
COMMENT ON COLUMN public.session_metadata.synthesizing IS 'Whether workflow synthesis is currently running';
COMMENT ON COLUMN public.session_metadata.synthesis_complete IS 'Whether workflow synthesis has completed';
