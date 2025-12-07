-- Change workflow_id and added_to_workflow_id from INTEGER to TEXT
-- This aligns with the new TypeScript workflow architecture where
-- UUID (github_folder) is the canonical workflow identifier

-- Drop the existing index first
DROP INDEX IF EXISTS idx_user_step_pool_workflow_id;

-- Alter workflow_id column from INTEGER to TEXT
ALTER TABLE user_step_pool
ALTER COLUMN workflow_id TYPE TEXT USING workflow_id::TEXT;

-- Alter added_to_workflow_id column from INTEGER to TEXT
ALTER TABLE user_step_pool
ALTER COLUMN added_to_workflow_id TYPE TEXT USING added_to_workflow_id::TEXT;

-- Recreate the index
CREATE INDEX idx_user_step_pool_workflow_id ON user_step_pool(workflow_id) WHERE workflow_id IS NOT NULL;

-- Add comment explaining the change
COMMENT ON COLUMN user_step_pool.workflow_id IS 'UUID folder ID (github_folder) - canonical workflow identifier';
COMMENT ON COLUMN user_step_pool.added_to_workflow_id IS 'UUID folder ID of workflow this step was added to';
