-- Check for any potential conflicts with web screenshot paths
-- These would be screenshots that were uploaded via the web interface using the old pattern

-- First, let's see what session_ids we have in the background processor results
SELECT DISTINCT session_id, user_id
FROM low_level_processed_screenshots 
WHERE processing_failed = false
LIMIT 10;

-- Check if we have any events from the web capture system that might conflict
SELECT 
  'Web capture events' as source,
  COUNT(*) as count
FROM low_level_events 
WHERE source = 'web' OR source IS NULL;

-- Check specifically for timestamp-based screenshot IDs that the web system might use
SELECT 
  'Sample event IDs from low_level_events' as source,
  id,
  session_id,
  user_id,
  left(payload::text, 100) as payload_sample
FROM low_level_events 
WHERE payload->'payload'->>'type' = 'screenshot_diff'
LIMIT 3;
