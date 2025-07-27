-- =====================================================================
-- CLEANUP LEGACY FUNCTIONS THAT USE MISALIGNED LOGIC
-- Remove or update functions that don't use timestamp matching
-- =====================================================================

-- Drop the old recalculate function that used workflow analysis counts
DROP FUNCTION IF EXISTS public.recalculate_session_workflow_analysis_counts();

-- Drop the old sync function that used simple counts
DROP FUNCTION IF EXISTS public.sync_all_processed_event_counts();

-- Update the main session metadata update function to use timestamp matching
CREATE OR REPLACE FUNCTION public.update_session_metadata_from_all_events()
RETURNS void AS $$
BEGIN
    -- Use timestamp matching logic (aligned with sequential processor)
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
        COALESCE(pe.processed_count, 0) as processed_event_count, -- TIMESTAMP MATCHING
        sa.total_ui_steps,
        sa.first_event_timestamp,
        sa.last_event_timestamp,
        EXTRACT(EPOCH FROM (sa.last_event_timestamp - sa.first_event_timestamp))
    FROM session_aggregates sa
    LEFT JOIN user_mapping um ON sa.session_id = um.session_id
    LEFT JOIN processed_events_by_session pe ON sa.session_id = pe.session_id
    ON CONFLICT (session_id) DO UPDATE SET
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count, -- TIMESTAMP MATCHING
        total_ui_steps = EXCLUDED.total_ui_steps,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXCLUDED.duration_seconds,
        user_id = COALESCE(session_metadata.user_id, EXCLUDED.user_id),
        session_type = EXCLUDED.session_type;
        
    RAISE NOTICE 'Updated session metadata with timestamp matching logic (aligned with sequential processor)';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update comment to reflect the new logic
COMMENT ON FUNCTION public.update_session_metadata_from_all_events() IS 'Updates session metadata using timestamp matching logic (aligned with sequential processor)';

-- Add a function to validate alignment with sequential processor
CREATE OR REPLACE FUNCTION validate_admin_dashboard_alignment()
RETURNS TABLE(user_id TEXT, admin_pending INTEGER, processor_pending INTEGER, aligned BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.user_id,
        GREATEST(0, COALESCE(ui_counts.total_ui_trees, 0) - COALESCE(analysis_counts.total_analyses, 0)) as admin_pending,
        COALESCE(unprocessed_counts.unprocessed, 0) as processor_pending,
        (GREATEST(0, COALESCE(ui_counts.total_ui_trees, 0) - COALESCE(analysis_counts.total_analyses, 0)) = COALESCE(unprocessed_counts.unprocessed, 0)) as aligned
    FROM (
        SELECT DISTINCT user_id FROM low_level_events_enriched WHERE event_type = 'ui_tree'
    ) u
    LEFT JOIN (
        SELECT user_id, COUNT(*) as total_ui_trees
        FROM low_level_events_enriched 
        WHERE event_type = 'ui_tree'
        GROUP BY user_id
    ) ui_counts ON u.user_id = ui_counts.user_id
    LEFT JOIN (
        SELECT user_id, COUNT(*) as total_analyses
        FROM low_level_workflow_analyses
        GROUP BY user_id
    ) analysis_counts ON u.user_id = analysis_counts.user_id
    LEFT JOIN (
        SELECT user_id, count_unprocessed_events_by_timestamp(user_id) as unprocessed
        FROM (SELECT DISTINCT user_id FROM low_level_events_enriched WHERE event_type = 'ui_tree') users
    ) unprocessed_counts ON u.user_id = unprocessed_counts.user_id
    WHERE COALESCE(ui_counts.total_ui_trees, 0) > 0
    ORDER BY admin_pending DESC, processor_pending DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION validate_admin_dashboard_alignment() IS 'Validates that admin dashboard and sequential processor show the same pending counts';

-- Run the validation to check current alignment
-- SELECT * FROM validate_admin_dashboard_alignment() WHERE NOT aligned; 