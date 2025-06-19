ALTER TABLE public.session_metadata
ADD COLUMN total_labeled_steps INTEGER DEFAULT 0,
ADD COLUMN human_labeled_steps INTEGER DEFAULT 0,
ADD COLUMN total_workflow_analyses INTEGER DEFAULT 0,
ADD COLUMN distinct_workflows_created INTEGER DEFAULT 0; 