-- =====================================================================
-- ALIGN ALL LOGIC WITH SEQUENTIAL PROCESSOR TIMESTAMP MATCHING
-- This migration creates functions and updates logic to use the same
-- timestamp matching approach as the sequential processor
-- =====================================================================

-- Function to count unprocessed events using sequential processor logic
CREATE OR REPLACE FUNCTION count_unprocessed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id
          AND e.event_type = 'ui_tree'
          AND NOT EXISTS (
              SELECT 1
              FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = e.user_id
                AND llwa.client_timestamp = e.created_at
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to count processed events using timestamp matching
CREATE OR REPLACE FUNCTION count_processed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id
          AND e.event_type = 'ui_tree'
          AND EXISTS (
              SELECT 1
              FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = e.user_id
                AND llwa.client_timestamp = e.created_at
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to count total UI tree events for a user
CREATE OR REPLACE FUNCTION count_total_ui_tree_events(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id
          AND e.event_type = 'ui_tree'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated function to recalculate session metadata using timestamp matching
CREATE OR REPLACE FUNCTION public.recalculate_session_metadata_with_timestamp_matching()
RETURNS void AS $$
BEGIN
    -- Update session metadata using timestamp matching logic
    WITH all_events AS (
        SELECT session_id, user_id, 'web' as session_type, client_timestamp as event_timestamp, 'web_activity' as item_type 
        FROM public.user_activity_data WHERE session_id IS NOT NULL
        UNION ALL
        SELECT session_id, user_id, 'low-level' as session_type, created_at as event_timestamp, (payload->'payload'->>'type') as item_type 
        FROM public.low_level_events WHERE session_id IS NOT NULL
    ),
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
    -- Calculate processed events using timestamp matching (aligned with sequential processor)
    processed_events_by_session AS (
        SELECT 
            e.session_id,
            COUNT(*) as processed_count
        FROM low_level_events_enriched e
        WHERE e.event_type = 'ui_tree'
          AND e.session_id IS NOT NULL
          AND EXISTS (
              SELECT 1
              FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = e.user_id
                AND llwa.client_timestamp = e.created_at
          )
        GROUP BY e.session_id
    ),
    user_mapping AS (
        SELECT DISTINCT ON (session_id)
            session_id,
            user_id
        FROM all_events
        WHERE user_id IS NOT NULL
        ORDER BY session_id, event_timestamp ASC
    )
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
        COALESCE(pe.processed_count, 0) as processed_event_count, -- NOW USES TIMESTAMP MATCHING
        sa.total_ui_steps,
        sa.first_event_timestamp,
        sa.last_event_timestamp,
        EXTRACT(EPOCH FROM (sa.last_event_timestamp - sa.first_event_timestamp))
    FROM session_aggregates sa
    LEFT JOIN user_mapping um ON sa.session_id = um.session_id
    LEFT JOIN processed_events_by_session pe ON sa.session_id = pe.session_id
    ON CONFLICT (session_id) DO UPDATE SET
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count, -- TIMESTAMP MATCHING COUNT
        total_ui_steps = EXCLUDED.total_ui_steps,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXCLUDED.duration_seconds,
        user_id = COALESCE(session_metadata.user_id, EXCLUDED.user_id),
        session_type = EXCLUDED.session_type;
        
    RAISE NOTICE 'Updated session metadata with timestamp matching logic';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the trigger function to use timestamp matching
CREATE OR REPLACE FUNCTION public.update_session_stats_on_analysis_change()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_processed_count INT;
    v_user_id TEXT;
BEGIN
    -- Determine the session_id and user_id from the record that triggered the function
    IF TG_OP = 'DELETE' THEN
        v_session_id := OLD.session_id;
        v_user_id := OLD.user_id;
    ELSE
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
    END IF;

    IF v_session_id IS NULL OR v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Recalculate processed events using timestamp matching logic
    SELECT COUNT(*)
    INTO v_processed_count
    FROM low_level_events_enriched e
    WHERE e.session_id = v_session_id
      AND e.event_type = 'ui_tree'
      AND EXISTS (
          SELECT 1
          FROM low_level_workflow_analyses llwa
          WHERE llwa.user_id = e.user_id
            AND llwa.client_timestamp = e.created_at
      );

    -- Update the session_metadata table with the timestamp-matched count
    UPDATE public.session_metadata
    SET processed_event_count = v_processed_count
    WHERE session_id = v_session_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run initial recalculation to fix existing data
SELECT public.recalculate_session_metadata_with_timestamp_matching();

-- Add comments explaining the new logic
COMMENT ON FUNCTION count_unprocessed_events_by_timestamp(TEXT) IS 'Counts unprocessed UI tree events using timestamp matching logic (same as sequential processor)';
COMMENT ON FUNCTION count_processed_events_by_timestamp(TEXT) IS 'Counts processed UI tree events using timestamp matching logic (same as sequential processor)';
COMMENT ON FUNCTION count_total_ui_tree_events(TEXT) IS 'Counts total UI tree events for a user';
COMMENT ON COLUMN public.session_metadata.processed_event_count IS 'Number of UI tree events with matching analyses by timestamp (aligned with sequential processor logic)'; 