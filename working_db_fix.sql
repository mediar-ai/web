-- Working database fix - no references to non-existent tables

-- 1. Check for active/long-running queries
SELECT 
    pid,
    now() - pg_stat_activity.query_start AS duration,
    query,
    state
FROM pg_stat_activity
WHERE state != 'idle'
AND now() - pg_stat_activity.query_start > interval '30 seconds'
ORDER BY duration DESC;

-- 2. Check for locks on our actual tables
SELECT 
    l.pid,
    l.mode,
    l.locktype,
    l.relation::regclass as table_name,
    a.query,
    a.state,
    now() - a.query_start as duration
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.relation IN (
    'session_metadata'::regclass,
    'low_level_workflow_analyses'::regclass
)
ORDER BY duration DESC;

-- 3. Kill hanging queries if needed (replace PID_NUMBER with actual PID)
-- SELECT pg_terminate_backend(PID_NUMBER);

-- 4. Fix the session_type constraint issue
DROP TRIGGER IF EXISTS update_session_on_workflow_analysis ON public.low_level_workflow_analyses;
DROP FUNCTION IF EXISTS public.update_session_metadata_on_workflow_analysis();

-- 5. Create the corrected function
CREATE OR REPLACE FUNCTION public.update_session_metadata_on_workflow_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id UUID;
    v_session_type TEXT := 'low-level';
BEGIN
    v_session_id := NEW.session_id;
    v_user_id := NEW.user_id;

    IF v_session_id IS NULL THEN 
        RETURN NEW;
    END IF;

    INSERT INTO public.session_metadata (
        session_id, user_id, processed_event_count, session_type
    )
    VALUES (v_session_id, v_user_id, 1, v_session_type)
    ON CONFLICT (session_id) DO UPDATE SET
        processed_event_count = session_metadata.processed_event_count + 1,
        user_id = COALESCE(session_metadata.user_id, v_user_id),
        session_type = COALESCE(session_metadata.session_type, v_session_type);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Recreate the trigger
CREATE TRIGGER update_session_on_workflow_analysis
    AFTER INSERT ON public.low_level_workflow_analyses
    FOR EACH ROW EXECUTE FUNCTION public.update_session_metadata_on_workflow_analysis(); 