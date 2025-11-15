-- Test TypeScript workflow execution with rust-executor
-- This creates a new execution for workflow 239 (OneDrive Installation Workflow)
-- which has preferred_format='typescript'

-- Insert a new execution that will be picked up by the rust-executor
INSERT INTO workflow_executions (
    workflow_id,
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
    'queued',
    'test-rust-typescript-fix',
    '{"test": "Testing TypeScript workflow execution via rust-executor after fix"}'::jsonb,
    NOW(),
    NOW(),
    NOW(),
    NULL,  -- Will be assigned when claimed
    'rust',  -- Force rust executor
    5
);

-- To check the status:
-- SELECT id, status, error_message, started_at, completed_at
-- FROM workflow_executions
-- WHERE client_id = 'test-rust-typescript-fix'
-- ORDER BY created_at DESC
-- LIMIT 1;

-- To see logs:
-- SELECT execution_logs, results
-- FROM workflow_executions
-- WHERE client_id = 'test-rust-typescript-fix'
-- ORDER BY created_at DESC
-- LIMIT 1;