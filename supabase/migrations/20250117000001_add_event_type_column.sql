-- Migration 1: Add event_type column only
-- This will be the most frequently used column for filtering

-- Add event_type column (nullable initially for backfill)
ALTER TABLE low_level_events 
ADD COLUMN IF NOT EXISTS event_type TEXT;

-- Add comment explaining the purpose
COMMENT ON COLUMN low_level_events.event_type IS
'Extracted from payload.payload.type or payload.type - used for fast filtering instead of JSONB queries';

-- Log progress
DO $$
BEGIN
    RAISE NOTICE 'Migration 1/4 complete: Added event_type column to low_level_events';
END $$; 