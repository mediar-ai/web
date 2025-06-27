-- Fix processed_event_count to count actual workflow analysis results
-- This makes the admin interface show meaningful data: analyses_completed / ui_steps_total

-- =====================================================================
-- Function: Update session metadata when workflow analysis is inserted
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_session_metadata_on_workflow_analysis()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id UUID;
BEGIN
    -- Get session and user info from the new workflow analysis
    v_session_id := NEW.session_id;
    v_user_id := NEW.user_id;

    -- Skip if session_id is null
    IF v_session_id IS NULL THEN 
        RETURN NEW;
    END IF;

    -- Update the session metadata to increment workflow analysis count
    INSERT INTO public.session_metadata (session_id, user_id, processed_event_count)
    VALUES (v_session_id, v_user_id, 1)
    ON CONFLICT (session_id) DO UPDATE SET
        processed_event_count = session_metadata.processed_event_count + 1,
        -- Update user_id if it was null
        user_id = COALESCE(session_metadata.user_id, v_user_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- Trigger: Fire when new workflow analysis is inserted
-- =====================================================================
DO $$
BEGIN
    -- Drop existing trigger if it exists
    DROP TRIGGER IF EXISTS update_session_on_workflow_analysis ON public.low_level_workflow_analyses;
    
    -- Create new trigger
    CREATE TRIGGER update_session_on_workflow_analysis
        AFTER INSERT ON public.low_level_workflow_analyses
        FOR EACH ROW EXECUTE FUNCTION public.update_session_metadata_on_workflow_analysis();
END $$;

-- =====================================================================
-- Function: Batch recalculate all session workflow analysis counts
-- =====================================================================
CREATE OR REPLACE FUNCTION public.recalculate_session_workflow_analysis_counts()
RETURNS void AS $$
BEGIN
    -- Update all sessions with correct workflow analysis counts
    UPDATE public.session_metadata
    SET processed_event_count = workflow_counts.analysis_count
    FROM (
        SELECT 
            session_id,
            COUNT(*) as analysis_count
        FROM public.low_level_workflow_analyses
        WHERE session_id IS NOT NULL
        GROUP BY session_id
    ) as workflow_counts
    WHERE session_metadata.session_id = workflow_counts.session_id;

    -- Set processed_event_count to 0 for sessions with no workflow analyses
    UPDATE public.session_metadata
    SET processed_event_count = 0
    WHERE session_id NOT IN (
        SELECT DISTINCT session_id 
        FROM public.low_level_workflow_analyses 
        WHERE session_id IS NOT NULL
    );
    
    RAISE NOTICE 'Recalculated workflow analysis counts for all sessions';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- Update existing batch function to use new logic  
-- =====================================================================
CREATE OR REPLACE FUNCTION public.update_session_metadata_from_all_events()
RETURNS void AS $$
BEGIN
    -- This CTE gets all events from both sources for basic session metadata
    WITH all_events AS (
        SELECT session_id, user_id, 'web' as session_type, client_timestamp as event_timestamp, 'web_activity' as item_type FROM public.user_activity_data WHERE session_id IS NOT NULL
        UNION ALL
        SELECT session_id, user_id, 'low-level' as session_type, created_at as event_timestamp, (payload->'payload'->>'type') as item_type FROM public.low_level_events WHERE session_id IS NOT NULL
    ),
    -- Calculate basic session aggregates (events, ui_steps, duration)
    session_aggregates AS (
        SELECT
            session_id,
            CASE 
                WHEN COUNT(DISTINCT session_type) > 1 THEN 'mixed'
                ELSE MAX(session_type)
            END as session_type,
            COUNT(*) as raw_event_count,
            SUM(CASE WHEN item_type = 'ui_tree' THEN 1 ELSE 0 END) as total_ui_steps,
            MIN(event_timestamp) as first_event_timestamp,
            MAX(event_timestamp) as last_event_timestamp
        FROM all_events
        GROUP BY session_id
    ),
    -- Count workflow analyses separately
    workflow_analysis_counts AS (
        SELECT 
            session_id,
            COUNT(*) as workflow_analysis_count
        FROM public.low_level_workflow_analyses
        WHERE session_id IS NOT NULL
        GROUP BY session_id
    ),
    -- Map user_ids to sessions
    user_mapping AS (
        SELECT DISTINCT ON (session_id)
            session_id,
            user_id
        FROM all_events
        WHERE user_id IS NOT NULL
        ORDER BY session_id, event_timestamp ASC
    )
    -- Update session metadata with correct values
    INSERT INTO public.session_metadata (
        session_id, user_id, session_type, event_count, 
        processed_event_count, total_ui_steps, 
        first_event_timestamp, last_event_timestamp, duration_seconds
    )
    SELECT
        sa.session_id,
        um.user_id,
        sa.session_type,
        sa.raw_event_count,
        COALESCE(wac.workflow_analysis_count, 0) as processed_event_count, -- NOW COUNTS WORKFLOW ANALYSES
        sa.total_ui_steps,
        sa.first_event_timestamp,
        sa.last_event_timestamp,
        EXTRACT(EPOCH FROM (sa.last_event_timestamp - sa.first_event_timestamp))
    FROM session_aggregates sa
    LEFT JOIN user_mapping um ON sa.session_id = um.session_id
    LEFT JOIN workflow_analysis_counts wac ON sa.session_id = wac.session_id
    ON CONFLICT (session_id) DO UPDATE SET
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count, -- WORKFLOW ANALYSIS COUNT
        total_ui_steps = EXCLUDED.total_ui_steps,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXCLUDED.duration_seconds,
        user_id = COALESCE(session_metadata.user_id, EXCLUDED.user_id),
        session_type = EXCLUDED.session_type;
        
    RAISE NOTICE 'Updated session metadata with workflow analysis counts';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================================
-- Run initial recalculation to fix existing data
-- =====================================================================
SELECT public.recalculate_session_workflow_analysis_counts();

-- Add comment explaining the new logic
COMMENT ON COLUMN public.session_metadata.processed_event_count IS 'Number of workflow analyses completed for this session (NOT ui_tree events). Shows actual processing progress.'; 