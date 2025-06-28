-- Create function to sync processed event counts across all sessions
CREATE OR REPLACE FUNCTION public.sync_all_processed_event_counts()
RETURNS TEXT AS $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    -- Update all session metadata with correct processed_event_count
    UPDATE public.session_metadata
    SET processed_event_count = workflow_counts.analysis_count
    FROM (
        SELECT 
            session_id,
            COUNT(*) as analysis_count
        FROM public.low_level_workflow_analyses
        WHERE session_id IS NOT NULL
        GROUP BY session_id
    ) as workflow_counts
    WHERE session_metadata.session_id = workflow_counts.session_id
    AND session_metadata.processed_event_count != workflow_counts.analysis_count;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;

    -- Set processed_event_count to 0 for sessions with no workflow analyses
    UPDATE public.session_metadata
    SET processed_event_count = 0
    WHERE session_id NOT IN (
        SELECT DISTINCT session_id 
        FROM public.low_level_workflow_analyses 
        WHERE session_id IS NOT NULL
    )
    AND processed_event_count > 0;

    GET DIAGNOSTICS v_updated_count = v_updated_count + ROW_COUNT;
    
    RETURN 'Processed event counts synced successfully. Updated ' || v_updated_count || ' sessions.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
