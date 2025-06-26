ALTER TABLE public.low_level_workflow_analyses
ADD COLUMN IF NOT EXISTS window_title TEXT,
ADD COLUMN IF NOT EXISTS label_status VARCHAR(20) DEFAULT 'pending';

COMMENT ON COLUMN public.low_level_workflow_analyses.window_title IS 'The title of the window in which the analysis occurred, captured for context and to avoid extra DB calls.';
COMMENT ON COLUMN public.low_level_workflow_analyses.label_status IS 'The processing status for the labeling task (e.g., pending, completed).'; 