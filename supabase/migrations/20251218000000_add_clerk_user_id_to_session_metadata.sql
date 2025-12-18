-- Add clerk_user_id column to session_metadata for Clerk authentication support
-- This allows tracking users who authenticate via Clerk (non-UUID user IDs)

-- Add the column
ALTER TABLE public.session_metadata
ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

-- Create index for lookups
CREATE INDEX IF NOT EXISTS idx_session_metadata_clerk_user_id
ON public.session_metadata(clerk_user_id)
WHERE clerk_user_id IS NOT NULL;

-- Backfill clerk_user_id from low_level_events payload for sessions with null user_id
-- This looks at the first event in each session to get the clerk_user_id
UPDATE public.session_metadata sm
SET clerk_user_id = subq.clerk_user_id
FROM (
    SELECT DISTINCT ON (e.session_id)
        e.session_id,
        e.payload->>'clerk_user_id' as clerk_user_id
    FROM public.low_level_events e
    WHERE e.user_id IS NULL
      AND e.payload->>'clerk_user_id' IS NOT NULL
    ORDER BY e.session_id, e.created_at ASC
) subq
WHERE sm.session_id = subq.session_id
  AND sm.user_id IS NULL
  AND sm.clerk_user_id IS NULL;

-- Update the trigger function to also extract clerk_user_id from payload
CREATE OR REPLACE FUNCTION public.update_session_metadata_on_event()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id UUID;  -- Must be UUID to match session_metadata.user_id column type
    v_clerk_user_id TEXT;
    v_event_timestamp TIMESTAMPTZ;
    v_session_type TEXT;
BEGIN
    IF TG_TABLE_NAME = 'low_level_events' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        -- Extract clerk_user_id from payload for Clerk authentication
        v_clerk_user_id := NEW.payload->>'clerk_user_id';
        v_event_timestamp := NEW.created_at;
        v_session_type := 'low-level';
    ELSIF TG_TABLE_NAME = 'user_activity_data' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        v_clerk_user_id := NULL; -- user_activity_data doesn't have clerk_user_id
        v_event_timestamp := NEW.client_timestamp;
        v_session_type := COALESCE(NEW.source, 'web');
    END IF;

    IF v_session_id IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.session_metadata (session_id, user_id, clerk_user_id, event_count, first_event_timestamp, last_event_timestamp, duration_seconds, session_type)
    VALUES (v_session_id, v_user_id, v_clerk_user_id, 1, v_event_timestamp, v_event_timestamp, 0, v_session_type)
    ON CONFLICT (session_id) DO UPDATE SET
        event_count = session_metadata.event_count + 1,
        last_event_timestamp = v_event_timestamp,
        duration_seconds = EXTRACT(EPOCH FROM (v_event_timestamp - session_metadata.first_event_timestamp)),
        session_type = CASE WHEN session_metadata.session_type != v_session_type THEN 'mixed' ELSE v_session_type END,
        -- Update clerk_user_id if it was null and we now have one
        clerk_user_id = COALESCE(session_metadata.clerk_user_id, v_clerk_user_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Log how many sessions were updated
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO updated_count
    FROM public.session_metadata
    WHERE clerk_user_id IS NOT NULL AND user_id IS NULL;

    RAISE NOTICE 'Backfilled clerk_user_id for % sessions', updated_count;
END $$;
