-- Check for active locks and transactions that might be causing hanging
-- Run these one by one to diagnose and fix the issue

-- 1. Check for active/long-running queries
SELECT 
    pid,
    now() - pg_stat_activity.query_start AS duration,
    query,
    state
FROM pg_stat_activity
WHERE state != 'idle'
AND now() - pg_stat_activity.query_start > interval '30 seconds'
ORDER BY duration DESC;

-- 2. Check for locks on our tables
SELECT 
    l.pid,
    l.mode,
    l.locktype,
    l.relation::regclass as table_name,
    a.query,
    a.state,
    now() - a.query_start as duration
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE l.relation IN (
    'session_metadata'::regclass,
    'low_level_workflow_analyses'::regclass,
    'screenshot_locks'::regclass
)
ORDER BY duration DESC;

-- 3. If you need to kill hanging queries (BE CAREFUL!)
-- First identify the problematic PIDs from above queries, then:
-- SELECT pg_terminate_backend(PID_NUMBER_HERE);

-- 4. Clear expired screenshot locks that might be blocking
DELETE FROM screenshot_locks 
WHERE expires_at < NOW();

-- 5. Check if there are any orphaned processing locks
SELECT user_id, event_id, processor_id, status, created_at 
FROM screenshot_locks 
WHERE created_at < NOW() - INTERVAL '1 hour'
ORDER BY created_at;

-- 6. Emergency cleanup - only run if really needed
-- DELETE FROM screenshot_locks WHERE created_at < NOW() - INTERVAL '10 minutes'; 