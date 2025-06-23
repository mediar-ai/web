-- Check total screenshot events
SELECT 'Total screenshot_diff events' as metric, COUNT(*) as count 
FROM low_level_events 
WHERE payload->'payload'->>'type' = 'screenshot_diff';

-- Check processed events  
SELECT 'Processed events' as metric, COUNT(*) as count
FROM low_level_processed_screenshots;

-- Check recent processing activity (last hour)
SELECT 'Recent processing (last hour)' as metric, COUNT(*) as count
FROM low_level_processed_screenshots 
WHERE processed_at > NOW() - INTERVAL '1 hour';

-- Check success vs failure rates
SELECT 
  processing_failed,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM low_level_processed_screenshots 
GROUP BY processing_failed;

-- Check storage stats
SELECT 
  'Total storage used (MB)' as metric,
  ROUND(COALESCE(SUM(before_size + after_size), 0) / 1024.0 / 1024.0, 2) as value
FROM low_level_processed_screenshots 
WHERE processing_failed = false;
