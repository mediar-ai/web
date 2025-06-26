-- This migration corrects the session type being set in the update_session_metadata_on_event function.
-- It changes the value from the incorrect 'lowLevel' to the correct 'low-level'.

CREATE OR REPLACE FUNCTION public.update_session_metadata_on_event()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id UUID;
    v_session_type TEXT;
    v_event_timestamp TIMESTAMPTZ;
    v_is_ui_tree BOOLEAN := FALSE;
BEGIN
    -- Determine which table the trigger came from and get the data
    IF TG_TABLE_NAME = 'user_activity_data' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        v_session_type := 'web';
        v_event_timestamp := NEW.client_timestamp;
    ELSIF TG_TABLE_NAME = 'low_level_events' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        v_session_type := 'low-level'; -- Corrected from 'lowLevel'
        v_event_timestamp := NEW.created_at;
        
        -- Check if this is a UI tree event
        v_is_ui_tree := (NEW.payload->'payload'->>'type' = 'ui_tree');
    ELSE
        RETURN NULL;
    END IF;

    -- Ensure we don't try to insert a NULL session_id
    IF v_session_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Upsert logic for the session_metadata table
    INSERT INTO public.session_metadata (session_id, user_id, session_type, first_event_timestamp, last_event_timestamp, event_count, total_ui_steps)
    VALUES (v_session_id, v_user_id, v_session_type, v_event_timestamp, v_event_timestamp, 1, CASE WHEN v_is_ui_tree THEN 1 ELSE 0 END)
    ON CONFLICT (session_id)
    DO UPDATE SET
        event_count = session_metadata.event_count + 1,
        total_ui_steps = CASE 
            WHEN v_is_ui_tree THEN session_metadata.total_ui_steps + 1 
            ELSE session_metadata.total_ui_steps 
        END,
        last_event_timestamp = v_event_timestamp,
        -- Only update user_id if it's currently NULL
        user_id = COALESCE(session_metadata.user_id, v_user_id),
        -- Ensure session type is updated if it was somehow different
        session_type = EXCLUDED.session_type;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
