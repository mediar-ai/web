-- =====================================================================
-- CONVERT user_id COLUMNS FROM UUID TO TEXT
-- This allows storing Clerk user IDs (e.g., "user_2yyba...") directly
-- =====================================================================

-- 1. Alter low_level_events.user_id from UUID to TEXT
ALTER TABLE public.low_level_events
ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- 2. Alter session_metadata.user_id from UUID to TEXT
ALTER TABLE public.session_metadata
ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- 3. Alter user_activity_data.user_id from UUID to TEXT (if it exists and is UUID)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_activity_data'
        AND column_name = 'user_id'
        AND data_type = 'uuid'
    ) THEN
        ALTER TABLE public.user_activity_data
        ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    END IF;
END $$;

-- 4. Alter low_level_workflow_analyses.user_id from UUID to TEXT (if it exists and is UUID)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'low_level_workflow_analyses'
        AND column_name = 'user_id'
        AND data_type = 'uuid'
    ) THEN
        ALTER TABLE public.low_level_workflow_analyses
        ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;
    END IF;
END $$;

-- 5. Update the session metadata trigger function to use TEXT
CREATE OR REPLACE FUNCTION public.update_session_metadata_on_event()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_user_id TEXT;  -- Changed from UUID to TEXT
    v_event_timestamp TIMESTAMPTZ;
    v_session_type TEXT;
BEGIN
    IF TG_TABLE_NAME = 'low_level_events' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;  -- Now TEXT, can hold Clerk IDs directly
        v_event_timestamp := NEW.created_at;
        v_session_type := 'low-level';
    ELSIF TG_TABLE_NAME = 'user_activity_data' THEN
        v_session_id := NEW.session_id;
        v_user_id := NEW.user_id;
        v_event_timestamp := NEW.client_timestamp;
        v_session_type := COALESCE(NEW.source, 'web');
    END IF;

    IF v_session_id IS NULL THEN RETURN NULL; END IF;

    INSERT INTO public.session_metadata (session_id, user_id, event_count, first_event_timestamp, last_event_timestamp, duration_seconds, session_type)
    VALUES (v_session_id, v_user_id, 1, v_event_timestamp, v_event_timestamp, 0, v_session_type)
    ON CONFLICT (session_id) DO UPDATE SET
        event_count = session_metadata.event_count + 1,
        last_event_timestamp = v_event_timestamp,
        duration_seconds = EXTRACT(EPOCH FROM (v_event_timestamp - session_metadata.first_event_timestamp)),
        session_type = CASE WHEN session_metadata.session_type != v_session_type THEN 'mixed' ELSE v_session_type END,
        -- Update user_id if it was null and we now have one
        user_id = COALESCE(session_metadata.user_id, v_user_id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Update RPC functions to remove UUID casts (user_id is now TEXT)
CREATE OR REPLACE FUNCTION count_unprocessed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id  -- Removed ::uuid cast
          AND e.event_type = 'ui_tree'
          AND e.id NOT IN (
              SELECT DISTINCT source_ui_tree_event_id
              FROM low_level_workflow_analyses
              WHERE user_id = p_user_id  -- Removed ::uuid cast
              AND source_ui_tree_event_id IS NOT NULL
          )
          AND NOT EXISTS (
              SELECT 1
              FROM low_level_workflow_analyses llwa
              WHERE llwa.user_id = e.user_id
                AND llwa.client_timestamp = e.created_at
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION count_processed_events_by_timestamp(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id  -- Removed ::uuid cast
          AND e.event_type = 'ui_tree'
          AND (
              e.id IN (
                  SELECT DISTINCT source_ui_tree_event_id
                  FROM low_level_workflow_analyses
                  WHERE user_id = p_user_id  -- Removed ::uuid cast
                  AND source_ui_tree_event_id IS NOT NULL
              )
              OR EXISTS (
                  SELECT 1
                  FROM low_level_workflow_analyses llwa
                  WHERE llwa.user_id = e.user_id
                    AND llwa.client_timestamp = e.created_at
              )
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION count_total_ui_tree_events(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)::INTEGER
        FROM low_level_events_enriched e
        WHERE e.user_id = p_user_id  -- Removed ::uuid cast
          AND e.event_type = 'ui_tree'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION count_distinct_sessions(p_user_id TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(DISTINCT session_id)::INTEGER
        FROM session_metadata
        WHERE user_id = p_user_id  -- Removed ::uuid cast
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Log migration completion
DO $$
BEGIN
    RAISE NOTICE 'Migration complete: user_id columns converted from UUID to TEXT';
    RAISE NOTICE 'Clerk user IDs can now be stored directly in user_id columns';
END $$;
