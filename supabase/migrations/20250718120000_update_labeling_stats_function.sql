-- Step 1: Add a new column to the session_metadata table to store the total labeled steps.
ALTER TABLE public.session_metadata
ADD COLUMN IF NOT EXISTS total_labeled_steps INTEGER DEFAULT 0;

-- Step 2: Create a new function to calculate and update labeling stats for a session.
CREATE OR REPLACE FUNCTION public.update_session_labeling_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_total_labels INT;
    v_human_labels INT;
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

    -- Recalculate both the total and human-labeled counts for the affected session.
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE label_status = 'completed')
    INTO
        v_total_labels,
        v_human_labels
    FROM
        public.low_level_workflow_analyses
    WHERE
        session_id = v_session_id;

    -- Update the session_metadata table with the new counts.
    UPDATE public.session_metadata
    SET
        total_labeled_steps = v_total_labels,
        human_labeled_steps = v_human_labels
    WHERE
        session_id = v_session_id;

    RETURN NULL; -- Result is ignored for AFTER triggers.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Create a trigger that calls the function whenever labeling-related data changes.
DROP TRIGGER IF EXISTS on_analysis_label_change ON public.low_level_workflow_analyses;
CREATE TRIGGER on_analysis_label_change
AFTER INSERT OR DELETE OR UPDATE OF label_status ON public.low_level_workflow_analyses
FOR EACH ROW
EXECUTE FUNCTION public.update_session_labeling_stats(); 