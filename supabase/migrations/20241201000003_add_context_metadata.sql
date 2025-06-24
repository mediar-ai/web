-- Add context metadata column to track what context was provided for each analysis
ALTER TABLE public.low_level_workflow_analyses 
ADD COLUMN IF NOT EXISTS context_metadata JSONB;

-- Create index for efficient context metadata queries
CREATE INDEX IF NOT EXISTS idx_context_metadata_gin ON public.low_level_workflow_analyses USING GIN (context_metadata);

-- Add some useful indexes for common context metadata queries
CREATE INDEX IF NOT EXISTS idx_context_metadata_screenshot_before ON public.low_level_workflow_analyses ((context_metadata->>'has_screenshot_before'));
CREATE INDEX IF NOT EXISTS idx_context_metadata_screenshot_after ON public.low_level_workflow_analyses ((context_metadata->>'has_screenshot_after'));
CREATE INDEX IF NOT EXISTS idx_context_metadata_ui_tree_diff ON public.low_level_workflow_analyses ((context_metadata->>'has_ui_tree_diff'));
CREATE INDEX IF NOT EXISTS idx_context_metadata_previous_analyses ON public.low_level_workflow_analyses ((context_metadata->>'has_previous_analyses'));

-- Comment describing the structure
COMMENT ON COLUMN public.low_level_workflow_analyses.context_metadata IS 'JSONB object tracking what context fields were provided for this analysis. Example: {"has_screenshot_before": true, "has_screenshot_after": false, "has_ui_tree_diff": true, "screenshot_count": 2, "events_count": 5, "previous_analyses_count": 3}'; 