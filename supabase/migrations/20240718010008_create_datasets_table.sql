-- Drop the table if it exists to ensure a clean slate
DROP TABLE IF EXISTS public.low_level_datasets;

-- Recreate the table with a more structured data column
CREATE TABLE IF NOT EXISTS low_level_datasets (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id UUID,
    dataset_type TEXT NOT NULL, -- e.g., 'workflow_event_feedback'
    
    -- Link to the original analysis
    low_level_workflow_analysis_id BIGINT REFERENCES public.low_level_workflow_analyses(id) ON DELETE CASCADE,
    
    -- Store the generated content and feedback
    generated_output TEXT,
    feedback TEXT, -- 'good', 'bad', 'irrelevant'
    feedback_reason TEXT,

    -- Ensure one feedback entry per analysis per dataset type
    CONSTRAINT unique_feedback_entry UNIQUE (dataset_type, low_level_workflow_analysis_id)
);

-- Add a comment to describe the purpose of the table
COMMENT ON TABLE low_level_datasets IS 'A generic table to store various datasets for analysis and model training, such as user feedback on generated content.';

-- No RLS policies for now, as it's accessed via service key.
-- We can add them later if direct client access is needed. 