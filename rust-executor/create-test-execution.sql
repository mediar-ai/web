-- Create a test execution for OneDrive Installation Workflow (TypeScript)
-- This will be picked up by local rust-executor

INSERT INTO workflow_executions (
    workflow_id,
    workflow_version_id,
    status,
    client_id,
    execution_params,
    queued_at,
    created_at,
    updated_at,
    assigned_machine_id,
    executor_type,
    priority
) VALUES (
    239,  -- OneDrive Installation Workflow (TypeScript)
    (SELECT MAX(id) FROM workflow_versions WHERE workflow_id = 239),
    'queued',
    'local-rust-test-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'),
    '{
        "test": true,
        "note": "Testing TypeScript workflow execution via local rust-executor after fix"
    }'::jsonb,
    NOW(),
    NOW(),
    NOW(),
    NULL,  -- Will be assigned when claimed
    'rust',  -- Force rust executor
    10  -- High priority
) RETURNING id, client_id;

-- Query to check status:
-- SELECT id, status, error_message, started_at, completed_at
-- FROM workflow_executions
-- WHERE client_id LIKE 'local-rust-test-%'
-- ORDER BY created_at DESC
-- LIMIT 1;