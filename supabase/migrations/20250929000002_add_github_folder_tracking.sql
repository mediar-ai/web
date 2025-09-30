-- Add github_folder column for unique folder-based identification
-- This avoids exposing IDs in public repos

ALTER TABLE public.deployed_workflows
ADD COLUMN IF NOT EXISTS github_folder text UNIQUE;

-- Index for fast lookups by folder
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_github_folder
    ON public.deployed_workflows(github_folder)
    WHERE github_folder IS NOT NULL;

-- Update existing workflows to set github_folder from github_path
UPDATE public.deployed_workflows
SET github_folder =
    CASE
        WHEN github_path LIKE '%/workflow.yaml' THEN
            regexp_replace(github_path, '/workflow\.yaml$', '')
        WHEN github_path LIKE '%/terminator.yml' THEN
            regexp_replace(github_path, '/terminator\.yml$', '')
        ELSE NULL
    END
WHERE github_path IS NOT NULL;

COMMENT ON COLUMN public.deployed_workflows.github_folder IS 'Unique folder path in GitHub repo (e.g., production/bestplanpro). Used as key for sync without exposing IDs';