-- First, let's drop the old trigger function and trigger if they exist
-- to avoid conflicts and ensure a clean re-creation.
DROP TRIGGER IF EXISTS update_session_on_analysis_insert ON public.low_level_workflow_analyses;
DROP FUNCTION IF EXISTS public.update_session_on_analysis();

-- Now, create or replace the comprehensive function that handles all session metadata updates.
CREATE OR REPLACE FUNCTION public.update_session_stats_on_analysis_change()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_total_analyses INT;
    v_completed_analyses INT;
    v_human_labeled INT;
BEGIN
    -- Determine the session_id from the record that triggered the function.
    IF TG_OP = 'DELETE' THEN
        v_session_id := OLD.session_id;
    ELSE
        v_session_id := NEW.session_id;
    END IF;

    IF v_session_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Recalculate all analysis-related stats for the affected session.
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE label_status = 'completed')
    INTO
        v_total_analyses,
        v_completed_analyses
    FROM
        public.low_level_workflow_analyses
    WHERE
        session_id = v_session_id;
        
    SELECT
        COUNT(*)
    INTO
        v_human_labeled
    FROM
        public.low_level_datasets
    WHERE 
        low_level_workflow_analysis_id IN (SELECT id FROM public.low_level_workflow_analyses WHERE session_id = v_session_id);

    -- Update the session_metadata table with all the new counts.
    UPDATE public.session_metadata
    SET
        total_workflow_analyses = v_total_analyses,
        total_labeled_steps = v_completed_analyses, -- This is the count of 'completed' statuses
        human_labeled_steps = v_human_labeled, -- This is the count from the datasets table
        processed_event_count = v_total_analyses -- Assuming processed_event_count is the same as total_workflow_analyses
    WHERE
        session_id = v_session_id;

    RETURN NULL; -- Result is ignored for AFTER triggers.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a single, comprehensive trigger for all relevant changes.
DROP TRIGGER IF EXISTS on_analysis_change ON public.low_level_workflow_analyses;
CREATE TRIGGER on_analysis_change
AFTER INSERT OR DELETE OR UPDATE OF label_status ON public.low_level_workflow_analyses
FOR EACH ROW
EXECUTE FUNCTION public.update_session_stats_on_analysis_change(); 