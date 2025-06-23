-- Check the most recent processing activity
SELECT 
  processed_at,
  processing_failed,
  failure_reason,
  before_size,
  after_size
FROM low_level_processed_screenshots 
ORDER BY processed_at DESC 
LIMIT 10;

-- Check processing over time (last few hours)
SELECT 
  DATE_TRUNC('hour', processed_at) as hour,
  COUNT(*) as processed_count,
  SUM(CASE WHEN processing_failed = false THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN processing_failed = true THEN 1 ELSE 0 END) as failed
FROM low_level_processed_screenshots 
WHERE processed_at > NOW() - INTERVAL '6 hours'
GROUP BY DATE_TRUNC('hour', processed_at)
ORDER BY hour DESC;
