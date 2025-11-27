-- Add tags column to deployed_workflows for filtering (dev, prod, wip, etc.)
ALTER TABLE deployed_workflows ADD COLUMN IF NOT EXISTS tags text[] DEFAULT ARRAY[]::text[];

-- Create index for efficient tag filtering
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_tags ON deployed_workflows USING GIN (tags);

-- Add comment for documentation
COMMENT ON COLUMN deployed_workflows.tags IS 'Array of tags for filtering workflows (e.g., dev, prod, wip, test)';
