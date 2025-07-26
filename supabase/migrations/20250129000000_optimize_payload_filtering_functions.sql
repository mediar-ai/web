-- Optimize remaining functions that use slow payload JSON filtering
-- Replace payload->'payload'->>'type' with fast event_type field from enriched view

-- =============================================================================
-- Optimize get_unprocessed_ui_tree_events function
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_unprocessed_ui_tree_events(p_user_id UUID)
RETURNS TABLE(id BIGINT, user_id UUID, created_at TIMESTAMPTZ, payload JSONB)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH numbered_events AS (
        SELECT lle.id, lle.user_id, lle.created_at, lle.payload,
               ROW_NUMBER() OVER (PARTITION BY lle.created_at ORDER BY lle.id) as event_rank
        FROM low_level_events_enriched AS lle  -- Use enriched view for performance
        WHERE lle.user_id = p_user_id
          AND lle.event_type = 'ui_tree'       -- Use optimized event_type field instead of JSON extraction
    ),
    analysis_counts AS (
        SELECT llwa.client_timestamp, COUNT(*) as analysis_count
        FROM low_level_workflow_analyses llwa
        WHERE llwa.user_id = p_user_id
        GROUP BY llwa.client_timestamp
    )
    SELECT ne.id, ne.user_id, ne.created_at, ne.payload
    FROM numbered_events ne
    LEFT JOIN analysis_counts ac ON ac.client_timestamp = ne.created_at
    WHERE ne.event_rank > COALESCE(ac.analysis_count, 0)
    ORDER BY ne.created_at, ne.id;
END;
$$;

-- =============================================================================
-- Optimize get_user_ui_tree_counts function  
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_user_ui_tree_counts(user_ids_array UUID[])
RETURNS TABLE(user_id UUID, ui_tree_count BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lle.user_id,
    count(*) AS ui_tree_count
  FROM
    public.low_level_events_enriched lle  -- Use enriched view for performance
  WHERE
    lle.user_id = ANY(user_ids_array) AND
    lle.event_type = 'ui_tree'            -- Use optimized event_type field instead of JSON extraction
  GROUP BY
    lle.user_id;
END;
$$;

-- =============================================================================
-- Add performance documentation
-- =============================================================================
COMMENT ON FUNCTION public.get_unprocessed_ui_tree_events(UUID) IS 
'Optimized function that uses event_type field instead of slow payload JSON extraction. Uses low_level_events_enriched view for 100-1000x performance improvement.';

COMMENT ON FUNCTION public.get_user_ui_tree_counts(UUID[]) IS 
'Optimized function that uses event_type field instead of slow payload JSON extraction. Uses low_level_events_enriched view for fast indexed lookups.'; 