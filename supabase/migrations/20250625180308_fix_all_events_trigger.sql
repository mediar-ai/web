-- This migration corrects the session type being set in the update_session_metadata_from_all_events function.
-- It changes the value from the incorrect 'lowLevel' to the correct 'low-level'.

CREATE OR REPLACE FUNCTION public.update_session_metadata_from_all_events()
RETURNS void AS $$
BEGIN
    -- This CTE gets all events from both sources
    WITH all_events AS (
        SELECT session_id, user_id, 'web' as session_type, client_timestamp as event_timestamp, 'web_activity' as item_type FROM public.user_activity_data WHERE session_id IS NOT NULL
        UNION ALL
        SELECT session_id, user_id, 'low-level' as session_type, created_at as event_timestamp, (payload->'payload'->>'type') as item_type FROM public.low_level_events WHERE session_id IS NOT NULL
    ),
    -- This CTE calculates all aggregated values for each session
    session_aggregates AS (
        SELECT
            session_id,
            -- Logic to determine final session_type
            CASE 
                WHEN COUNT(DISTINCT session_type) > 1 THEN 'mixed'
                ELSE MAX(session_type)
            END as session_type,
            COUNT(*) as raw_event_count,
            SUM(CASE WHEN item_type = 'ui_tree' THEN 1 ELSE 0 END) as processed_event_count,
            MIN(event_timestamp) as first_event_timestamp,
            MAX(event_timestamp) as last_event_timestamp
        FROM all_events
        GROUP BY session_id
    ),
    -- This CTE finds the first non-null user_id for each session
    user_mapping AS (
        SELECT DISTINCT ON (session_id)
            session_id,
            user_id
        FROM all_events
        WHERE user_id IS NOT NULL
        ORDER BY session_id, event_timestamp ASC
    )
    -- This final statement joins the aggregations with the user mapping
    INSERT INTO public.session_metadata (session_id, user_id, session_type, event_count, processed_event_count, first_event_timestamp, last_event_timestamp, duration_seconds)
    SELECT
        sa.session_id,
        um.user_id,
        sa.session_type,
        sa.raw_event_count,
        sa.processed_event_count,
        sa.first_event_timestamp,
        sa.last_event_timestamp,
        EXTRACT(EPOCH FROM (sa.last_event_timestamp - sa.first_event_timestamp))
    FROM
        session_aggregates sa
    LEFT JOIN
        user_mapping um ON sa.session_id = um.session_id
    ON CONFLICT (session_id) DO UPDATE 
    SET
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXTRACT(EPOCH FROM (EXCLUDED.last_event_timestamp - EXCLUDED.first_event_timestamp)),
        user_id = COALESCE(session_metadata.user_id, EXCLUDED.user_id),
        session_type = EXCLUDED.session_type;
END;
$$ LANGUAGE plpgsql;
