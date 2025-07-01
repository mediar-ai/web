-- Add a column to store the complete workflow JSON
ALTER TABLE deployed_workflows 
ADD COLUMN IF NOT EXISTS workflow_json JSONB;

-- Update the workflow
UPDATE deployed_workflows 
SET workflow_json = '{{WORKFLOW_JSON_HERE}}'::jsonb
WHERE id = 1;
