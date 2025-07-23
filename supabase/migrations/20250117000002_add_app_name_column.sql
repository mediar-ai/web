-- Migration 2: Add app_name column only
-- For application context in analysis

-- Add app_name column (nullable)
ALTER TABLE low_level_events 
ADD COLUMN IF NOT EXISTS app_name TEXT;

-- Add comment explaining the purpose
COMMENT ON COLUMN low_level_events.app_name IS
'Extracted from payload.payload.event.app_name - application name for UI context';

-- Log progress
DO $$
BEGIN
    RAISE NOTICE 'Migration 2/4 complete: Added app_name column to low_level_events';
END $$; 