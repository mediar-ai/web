-- Check the most recent processing activity
SELECT 
  processed_at,
  processing_failed,
  before_size,
  after_size
FROM low_level_processed_screenshots 
ORDER BY processed_at DESC 
LIMIT 10;
