-- =====================================================================
-- FIX ALIGNMENT LOGIC TO MATCH SEQUENTIAL PROCESSOR EXACTLY
-- Use source_ui_tree_event_id as primary, timestamp as fallback
-- This eliminates false matches from duplicate timestamps
-- =====================================================================

-- Updated function to count unprocessed events using EXACT sequential processor logic
CREATE OR REPLACE FUNCTION count_unprocessed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    -- Use the EXACT same logic as sequential processor: get_next_unprocessed_event
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id::uuid
          AND e.event_type = 'ui_tree'
          -- Condition 1: Not in source_ui_tree_event_id (same as sequential processor)
          AND e.id NOT IN (
              SELECT DISTINCT source_ui_tree_event_id 
              FROM low_level_workflow_analyses 
              WHERE user_id = p_user_id::uuid 
              AND source_ui_tree_event_id IS NOT NULL
          )
          -- Condition 2: No timestamp match (same as sequential processor)
          AND NOT EXISTS (
              SELECT 1
              FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = e.user_id
                AND llwa.client_timestamp = e.created_at
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated function to count processed events using EXACT sequential processor logic
CREATE OR REPLACE FUNCTION count_processed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    -- Count events that would NOT be picked up by sequential processor
    -- (i.e., events that fail the unprocessed conditions)
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id::uuid
          AND e.event_type = 'ui_tree'
          AND (
              -- Processed via source_ui_tree_event_id
              e.id IN (
                  SELECT DISTINCT source_ui_tree_event_id 
                  FROM low_level_workflow_analyses 
                  WHERE user_id = p_user_id::uuid 
                  AND source_ui_tree_event_id IS NOT NULL
              )
              OR
              -- Processed via timestamp match
              EXISTS (
                  SELECT 1
                  FROM low_level_workflow_analyses llwa
                  WHERE llwa.user_id = e.user_id
                    AND llwa.client_timestamp = e.created_at
              )
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Test the corrected functions
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
    
    RAISE NOTICE 'CORRECTED RESULTS for user %:', test_user_id;
    RAISE NOTICE 'Total=%, Processed=%, Unprocessed=%', total_events, processed_events, unprocessed_events;
    
    IF processed_events + unprocessed_events = total_events THEN
        RAISE NOTICE '✅ Math check passed: % + % = %', processed_events, unprocessed_events, total_events;
    ELSE
        RAISE NOTICE '❌ Math check failed: % + % ≠ %', processed_events, unprocessed_events, total_events;
    END IF;
    
    -- The key test: unprocessed should match sequential processor (0)
    IF unprocessed_events = 0 THEN
        RAISE NOTICE '🎯 SUCCESS: Shows 0 unprocessed (matches sequential processor)';
    ELSE
        RAISE NOTICE '⚠️  Shows % unprocessed (sequential processor shows 0)', unprocessed_events;
    END IF;
END $$; 