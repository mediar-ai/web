-- Check for any user_activity_data entries we might have missed
SELECT 
  item_type,
  COUNT(*) as count,
  MIN(client_timestamp) as earliest,
  MAX(client_timestamp) as latest
FROM user_activity_data 
GROUP BY item_type;

-- Check for any direct screenshot references in other tables
SELECT 
  'Screenshots in low_level_events' as source,
  COUNT(*) as count
FROM low_level_events 
WHERE payload::text LIKE '%screenshot%'
AND payload::text NOT LIKE '%screenshot_diff%';

-- Look for any evidence of web-based screenshot uploads
SELECT 
  source,
  COUNT(*) as count
FROM low_level_events 
WHERE source IS NOT NULL
GROUP BY source;
