-- =====================================================================
-- FIX SESSION METADATA TO USE CORRECTED ALIGNMENT LOGIC
-- Update session metadata to use the same logic as sequential processor
-- =====================================================================

-- Updated function to recalculate session metadata using EXACT sequential processor logic
CREATE OR REPLACE FUNCTION public.recalculate_session_metadata_with_corrected_logic()
RETURNS void AS $$
BEGIN
    -- Update session metadata using corrected sequential processor logic
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
    -- Calculate processed events using CORRECTED sequential processor logic
    processed_events_by_session AS (
        SELECT 
            e.session_id,
            COUNT(*) as processed_count
        FROM low_level_events_enriched e
        WHERE e.event_type = 'ui_tree'
          AND e.session_id IS NOT NULL
          AND (
              -- Processed via source_ui_tree_event_id (primary method)
              e.id IN (
                  SELECT DISTINCT source_ui_tree_event_id 
                  FROM low_level_workflow_analyses 
                  WHERE source_ui_tree_event_id IS NOT NULL
              )
              OR
              -- Processed via timestamp match (fallback method)
              EXISTS (
                  SELECT 1
                  FROM low_level_workflow_analyses llwa
                  WHERE llwa.user_id = e.user_id
                    AND llwa.client_timestamp = e.created_at
              )
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
        COALESCE(pe.processed_count, 0) as processed_event_count, -- CORRECTED LOGIC
        sa.total_ui_steps,
        sa.first_event_timestamp,
        sa.last_event_timestamp,
        EXTRACT(EPOCH FROM (sa.last_event_timestamp - sa.first_event_timestamp))
    FROM session_aggregates sa
    LEFT JOIN user_mapping um ON sa.session_id = um.session_id
    LEFT JOIN processed_events_by_session pe ON sa.session_id = pe.session_id
    ON CONFLICT (session_id) DO UPDATE SET
        event_count = EXCLUDED.event_count,
        processed_event_count = EXCLUDED.processed_event_count, -- CORRECTED LOGIC
        total_ui_steps = EXCLUDED.total_ui_steps,
        first_event_timestamp = EXCLUDED.first_event_timestamp,
        last_event_timestamp = EXCLUDED.last_event_timestamp,
        duration_seconds = EXCLUDED.duration_seconds,
        user_id = COALESCE(session_metadata.user_id, EXCLUDED.user_id),
        session_type = EXCLUDED.session_type;
        
    RAISE NOTICE 'Updated session metadata with CORRECTED sequential processor logic';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run the corrected recalculation
SELECT public.recalculate_session_metadata_with_corrected_logic();

-- Test the results for our test user
DO $$
DECLARE
    test_user_id TEXT := 'f717970e-11f4-2107-f717-970e11f42107';
    total_processed INT;
    total_steps INT;
BEGIN
    SELECT 
        SUM(processed_event_count),
        SUM(total_ui_steps)
    INTO total_processed, total_steps
    FROM session_metadata 
    WHERE user_id = test_user_id::uuid;
    
    RAISE NOTICE 'SESSION METADATA RESULTS for user %:', test_user_id;
    RAISE NOTICE 'Total steps: %, Total processed: %', total_steps, total_processed;
    
    IF total_processed = total_steps THEN
        RAISE NOTICE '🎯 SUCCESS: Session metadata now shows 0 unprocessed (% = %)', total_processed, total_steps;
    ELSE
        RAISE NOTICE '⚠️  Still showing % unprocessed (% - % = %)', (total_steps - total_processed), total_steps, total_processed, (total_steps - total_processed);
    END IF;
END $$; 