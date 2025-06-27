-- This function calculates and updates the labeling-specific stats for a given session.
-- It is designed to be called by triggers on low_level_workflow_analyses and low_level_datasets.
CREATE OR REPLACE FUNCTION public.calculate_and_update_labeling_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_session_id TEXT;
    v_completed_analyses INT;
    v_human_labeled INT;
BEGIN
    -- Determine the session_id from the record that triggered the function.
    IF TG_TABLE_NAME = 'low_level_workflow_analyses' THEN
        v_session_id := NEW.session_id;
    ELSIF TG_TABLE_NAME = 'low_level_datasets' THEN
        -- We need to find the session_id from the related analysis record.
        SELECT session_id INTO v_session_id
        FROM public.low_level_workflow_analyses
        WHERE id = NEW.low_level_workflow_analysis_id;
    END IF;

    IF v_session_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Recalculate the count of 'completed' analyses for the session.
    SELECT COUNT(*)
    INTO v_completed_analyses
    FROM public.low_level_workflow_analyses
    WHERE session_id = v_session_id AND label_status = 'completed';

    -- Recalculate the count of human-labeled datasets for the session.
    SELECT COUNT(*)
    INTO v_human_labeled
    FROM public.low_level_datasets
    WHERE low_level_workflow_analysis_id IN (
        SELECT id FROM public.low_level_workflow_analyses WHERE session_id = v_session_id
    );

    -- Update the session_metadata table with the new counts.
    UPDATE public.session_metadata
    SET
        total_labeled_steps = v_completed_analyses, -- This is the count of 'completed' statuses
        human_labeled_steps = v_human_labeled      -- This is the count from the datasets table
    WHERE
        session_id = v_session_id;

    RETURN NULL; -- Result is ignored for AFTER triggers.
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for updates to the 'label_status' column in 'low_level_workflow_analyses'.
DROP TRIGGER IF EXISTS on_analysis_label_update ON public.low_level_workflow_analyses;
CREATE TRIGGER on_analysis_label_update
AFTER UPDATE OF label_status ON public.low_level_workflow_analyses
FOR EACH ROW
EXECUTE FUNCTION public.calculate_and_update_labeling_stats();

-- Trigger for new entries in the 'low_level_datasets' table.
DROP TRIGGER IF EXISTS on_new_dataset_entry ON public.low_level_datasets;
CREATE TRIGGER on_new_dataset_entry
AFTER INSERT ON public.low_level_datasets
FOR EACH ROW
EXECUTE FUNCTION public.calculate_and_update_labeling_stats(); 