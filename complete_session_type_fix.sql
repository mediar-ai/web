-- Complete fix for session_type constraint violation
-- This replaces the function that's causing the issue

-- First, let's see what triggers exist
SELECT 
    trigger_name, 
    event_object_table, 
    action_statement 
FROM information_schema.triggers 
WHERE trigger_name LIKE '%workflow%analysis%' 
   OR trigger_name LIKE '%session%metadata%';

-- Drop the problematic trigger and function
DROP TRIGGER IF EXISTS update_session_on_workflow_analysis ON public.low_level_workflow_analyses;
DROP FUNCTION IF EXISTS public.update_session_metadata_on_workflow_analysis();

-- Create the corrected function that includes session_type
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

    -- Determine session_type by checking which table has events for this session
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
    -- IMPORTANT: Include session_type in the INSERT to avoid constraint violation
    INSERT INTO public.session_metadata (
        session_id, 
        user_id, 
        processed_event_count, 
        session_type,
        event_count,
        total_ui_steps,
        first_event_timestamp,
        last_event_timestamp,
        duration_seconds
    )
    VALUES (
        v_session_id, 
        v_user_id, 
        1, 
        v_session_type,
        0,  -- Will be updated by other triggers
        0,  -- Will be updated by other triggers  
        NOW(),
        NOW(),
        0
    )
    ON CONFLICT (session_id) DO UPDATE SET
        processed_event_count = session_metadata.processed_event_count + 1,
        -- Update user_id if it was null
        user_id = COALESCE(session_metadata.user_id, v_user_id),
        -- Update session_type if it was null
        session_type = COALESCE(session_metadata.session_type, v_session_type);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate the trigger
CREATE TRIGGER update_session_on_workflow_analysis
    AFTER INSERT ON public.low_level_workflow_analyses
    FOR EACH ROW EXECUTE FUNCTION public.update_session_metadata_on_workflow_analysis();

-- Test the fix by checking the function exists
SELECT proname, prosrc FROM pg_proc WHERE proname = 'update_session_metadata_on_workflow_analysis'; 