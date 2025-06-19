CREATE OR REPLACE FUNCTION get_unprocessed_ui_tree_events(p_user_id UUID)
RETURNS SETOF low_level_events AS $$
BEGIN
  RETURN QUERY
  SELECT lle.*
  FROM low_level_events AS lle
  LEFT JOIN low_level_workflow_analyses AS llwa
    ON lle.created_at = llwa.client_timestamp AND lle.user_id = llwa.user_id
  LEFT JOIN workflow_analysis_jobs AS waj
    ON lle.id = waj.event_id AND lle.user_id = waj.user_id
  WHERE lle.user_id = p_user_id
    AND lle.payload->'payload'->>'type' = 'ui_tree'
    AND llwa.id IS NULL
    AND waj.id IS NULL
  ORDER BY lle.created_at ASC;
END;
$$ LANGUAGE plpgsql; 