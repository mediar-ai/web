SELECT 
    id,
    status,
    created_at,
    updated_at,
    EXTRACT(EPOCH FROM (updated_at - created_at)) as duration_seconds,
    execution_params->'product_types' as product_types
FROM workflow_executions 
WHERE id BETWEEN 3882 AND 3889
ORDER BY id;
