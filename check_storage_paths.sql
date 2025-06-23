-- Check what exists in the low_level_processed_screenshots table
SELECT 
  'Background processor screenshots' as source,
  COUNT(*) as count,
  MIN(processed_at) as earliest,
  MAX(processed_at) as latest
FROM low_level_processed_screenshots 
WHERE processing_failed = false;

-- Check for any screenshot metadata from web uploads
SELECT 
  'Web upload metadata' as source,
  COUNT(*) as count,
  MIN(client_timestamp) as earliest,
  MAX(client_timestamp) as latest
FROM user_activity_data 
WHERE item_type = 'screenshot_metadata';

-- Sample some storage paths to see patterns
SELECT 
  'Sample background processor paths' as source,
  before_path,
  after_path
FROM low_level_processed_screenshots 
WHERE processing_failed = false 
AND (before_path IS NOT NULL OR after_path IS NOT NULL)
LIMIT 5;
