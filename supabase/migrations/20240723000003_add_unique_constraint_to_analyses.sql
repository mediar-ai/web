ALTER TABLE public.low_level_workflow_analyses
ADD CONSTRAINT unique_user_timestamp_analysis UNIQUE (user_id, client_timestamp); 