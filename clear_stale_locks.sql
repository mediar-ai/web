-- Clear stale processing locks by marking them as failed
UPDATE processing_locks 
SET status = 'failed', updated_at = NOW() 
WHERE status = 'in_progress' 
  AND created_at < NOW() - INTERVAL '10 minutes';

-- Show what was cleared
SELECT 
  user_id, 
  event_id, 
  created_at,
  updated_at,
  status
FROM processing_locks 
WHERE status = 'failed' 
  AND updated_at > NOW() - INTERVAL '1 minute'
ORDER BY updated_at DESC;
