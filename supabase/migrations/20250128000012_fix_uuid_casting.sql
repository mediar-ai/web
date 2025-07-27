-- =====================================================================
-- FIX UUID CASTING ISSUE IN TIMESTAMP MATCHING FUNCTIONS
-- The user_id columns are uuid type, need to cast TEXT parameter to uuid
-- =====================================================================

-- Fix the unprocessed events function with proper uuid casting
CREATE OR REPLACE FUNCTION count_unprocessed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id::uuid
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

-- Fix the processed events function with proper uuid casting
CREATE OR REPLACE FUNCTION count_processed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id::uuid
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

-- Fix the total events function with proper uuid casting
CREATE OR REPLACE FUNCTION count_total_ui_tree_events(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id::uuid
          AND e.event_type = 'ui_tree'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix the validation function with proper uuid casting
CREATE OR REPLACE FUNCTION validate_admin_dashboard_alignment()
RETURNS TABLE(user_id TEXT, admin_pending INTEGER, processor_pending INTEGER, aligned BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.user_id::TEXT,
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
        SELECT user_id, count_unprocessed_events_by_timestamp(user_id::TEXT) as unprocessed
        FROM (SELECT DISTINCT user_id FROM low_level_events_enriched WHERE event_type = 'ui_tree') users
    ) unprocessed_counts ON u.user_id = unprocessed_counts.user_id
    WHERE COALESCE(ui_counts.total_ui_trees, 0) > 0
    ORDER BY admin_pending DESC, processor_pending DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the trigger function to use proper uuid casting
CREATE OR REPLACE FUNCTION public.update_session_stats_on_analysis_change()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_processed_count INT;
    v_user_id uuid;
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
      AND e.user_id = v_user_id  -- No casting needed, both are uuid
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

-- Test the functions with a known user ID
DO $$
DECLARE
    test_user_id TEXT := 'f717970e-11f4-2107-f717-970e11f42107';
    total_events INT;
    processed_events INT;
    unprocessed_events INT;
BEGIN
    SELECT count_total_ui_tree_events(test_user_id) INTO total_events;
    SELECT count_processed_events_by_timestamp(test_user_id) INTO processed_events;
    SELECT count_unprocessed_events_by_timestamp(test_user_id) INTO unprocessed_events;
    
    RAISE NOTICE 'Test results for user %: Total=%, Processed=%, Unprocessed=%', 
        test_user_id, total_events, processed_events, unprocessed_events;
    
    IF processed_events + unprocessed_events = total_events THEN
        RAISE NOTICE '✅ Math check passed: % + % = %', processed_events, unprocessed_events, total_events;
    ELSE
        RAISE NOTICE '❌ Math check failed: % + % ≠ %', processed_events, unprocessed_events, total_events;
    END IF;
END $$; 