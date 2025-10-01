-- Fix testgitsync workflow to have an active version

-- Get the workflow
DO $$
DECLARE
  workflow_id INT;
  workflow_yaml TEXT;
  workflow_jsonb JSONB;
  version_id INT;
BEGIN
  -- Get workflow details
  SELECT id, automation_sequence_yaml, automation_sequence
  INTO workflow_id, workflow_yaml, workflow_jsonb
  FROM deployed_workflows
  WHERE github_folder = 'testgitsync';

  IF workflow_id IS NULL THEN
    RAISE NOTICE 'Workflow not found';
    RETURN;
  END IF;

  -- Create version entry
  INSERT INTO deployed_workflow_versions (
    workflow_id,
    version_number,
    automation_sequence_yaml,
    automation_sequence,
    preferred_format,
    is_active,
    change_notes
  )
  VALUES (
    workflow_id,
    '1.0.0',
    workflow_yaml,
    workflow_jsonb,
    'yaml',
    true,
    'Initial version created from GitHub'
  )
  RETURNING id INTO version_id;

  -- Update workflow to point to this version
  UPDATE deployed_workflows
  SET
    current_version_id = version_id,
    total_versions = 1
  WHERE id = workflow_id;

  RAISE NOTICE 'Created version % for workflow %', version_id, workflow_id;
END $$;
