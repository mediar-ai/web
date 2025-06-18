-- Create the generic datasets table
CREATE TABLE IF NOT EXISTS low_level_datasets (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id UUID,
    dataset_type TEXT NOT NULL, -- e.g., 'workflow_label_feedback'
    data JSONB NOT NULL,
    notes TEXT
);

-- Add a comment to describe the purpose of the table
COMMENT ON TABLE low_level_datasets IS 'A generic table to store various datasets for analysis and model training, such as user feedback on generated suggestions.';

-- No RLS policies for now, as it's accessed via service key.
-- We can add them later if direct client access is needed. 