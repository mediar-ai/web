-- Function to incrementally update session_metadata on a new event
CREATE OR REPLACE FUNCTION public.update_session_metadata_on_event()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id TEXT;
    v_event_timestamp TIMESTAMPTZ;
    v_session_type TEXT;
BEGIN
    -- Determine which table the trigger is for and get the relevant data
    IF TG_TABLE_NAME = 'low_level_events' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        v_event_timestamp := NEW.created_at;
        v_session_type := 'low-level';
    ELSIF TG_TABLE_NAME = 'user_activity_data' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        v_event_timestamp := NEW.client_timestamp;
        v_session_type := COALESCE(NEW.source, 'web');
    ELSE
        -- Should not happen, but good practice to handle
        RETURN NULL;
    END IF;

    -- If there's no session_id, we can't do anything
    IF v_session_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Perform the upsert on session_metadata
    INSERT INTO public.session_metadata (
        session_id,
        user_id,
        event_count,
        first_event_timestamp,
        last_event_timestamp,
        duration_seconds,
        session_type
    )
    VALUES (
        v_session_id,
        v_user_id,
        1, -- Initial event count
        v_event_timestamp,
        v_event_timestamp,
        0, -- Initial duration
        v_session_type
    )
    ON CONFLICT (session_id) DO UPDATE SET
        -- Increment the event count
        event_count = session_metadata.event_count + 1,
        
        -- Update the last_event_timestamp to the timestamp of the new event
        last_event_timestamp = v_event_timestamp,
        
        -- Recalculate the duration
        duration_seconds = EXTRACT(EPOCH FROM (v_event_timestamp - session_metadata.first_event_timestamp)),
        
        -- If session_type was different, mark it as 'mixed'
        session_type = CASE
                         WHEN session_metadata.session_type != v_session_type
                         THEN 'mixed'
                         ELSE v_session_type
                       END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for low_level_events table
CREATE TRIGGER handle_new_low_level_event
AFTER INSERT ON public.low_level_events
FOR EACH ROW
EXECUTE FUNCTION public.update_session_metadata_on_event();

-- Trigger for user_activity_data table
CREATE TRIGGER handle_new_user_activity_event  
AFTER INSERT ON public.user_activity_data
FOR EACH ROW
EXECUTE FUNCTION public.update_session_metadata_on_event(); 