CREATE OR REPLACE FUNCTION get_user_ui_tree_counts(user_ids_array uuid[])
RETURNS TABLE(user_id uuid, ui_tree_count bigint) AS $$
BEGIN
  RETURN QUERY
  SELECT
    lle.user_id,
    count(*) AS ui_tree_count
  FROM
    public.low_level_events lle
  WHERE
    lle.user_id = ANY(user_ids_array) AND
    lle.payload->'payload'->>'type' = 'ui_tree'
  GROUP BY
    lle.user_id;
END;
$$ LANGUAGE plpgsql; 