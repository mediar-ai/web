-- Fix the session_type constraint violation in update_session_metadata_on_workflow_analysis function
-- The issue is that when inserting new session_metadata records, we need to provide session_type

CREATE OR REPLACE FUNCTION public.update_session_metadata_on_workflow_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id UUID;
    v_session_type TEXT;
BEGIN
    -- Get session and user info from the new workflow analysis
    v_session_id := NEW.session_id;
    v_user_id := NEW.user_id;

    -- Skip if session_id is null
    IF v_session_id IS NULL THEN 
        RETURN NEW;
    END IF;

    -- Try to determine session_type from existing low_level_events
    SELECT CASE 
        WHEN EXISTS (
            SELECT 1 FROM public.low_level_events 
            WHERE session_id = v_session_id 
            LIMIT 1
        ) THEN 'low-level'
        WHEN EXISTS (
            SELECT 1 FROM public.user_activity_data 
            WHERE session_id = v_session_id 
            LIMIT 1
        ) THEN 'web'
        ELSE 'low-level'  -- Default to low-level since this is a workflow analysis
    END INTO v_session_type;

    -- Update the session metadata to increment workflow analysis count
    INSERT INTO public.session_metadata (session_id, user_id, processed_event_count, session_type)
    VALUES (v_session_id, v_user_id, 1, v_session_type)
    ON CONFLICT (session_id) DO UPDATE SET
        processed_event_count = session_metadata.processed_event_count + 1,
        -- Update user_id if it was null
        user_id = COALESCE(session_metadata.user_id, v_user_id),
        -- Update session_type if it was null
        session_type = COALESCE(session_metadata.session_type, v_session_type);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 