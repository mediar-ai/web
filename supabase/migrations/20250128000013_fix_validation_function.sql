-- =====================================================================
-- FIX VALIDATION FUNCTION COLUMN AMBIGUITY
-- =====================================================================

-- Fix the validation function with proper table aliases
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
        SELECT DISTINCT e.user_id FROM low_level_events_enriched e WHERE e.event_type = 'ui_tree'
    ) u
    LEFT JOIN (
        SELECT e.user_id, COUNT(*) as total_ui_trees
        FROM low_level_events_enriched e
        WHERE e.event_type = 'ui_tree'
        GROUP BY e.user_id
    ) ui_counts ON u.user_id = ui_counts.user_id
    LEFT JOIN (
        SELECT a.user_id, COUNT(*) as total_analyses
        FROM low_level_workflow_analyses a
        GROUP BY a.user_id
    ) analysis_counts ON u.user_id = analysis_counts.user_id
    LEFT JOIN (
        SELECT u2.user_id, count_unprocessed_events_by_timestamp(u2.user_id::TEXT) as unprocessed
        FROM (SELECT DISTINCT e.user_id FROM low_level_events_enriched e WHERE e.event_type = 'ui_tree') u2
    ) unprocessed_counts ON u.user_id = unprocessed_counts.user_id
    WHERE COALESCE(ui_counts.total_ui_trees, 0) > 0
    ORDER BY admin_pending DESC, processor_pending DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER; 