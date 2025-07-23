-- Migration 4: Add optimized indexes after backfill
-- Run this AFTER the backfill script completes successfully

-- Most critical index: user_id + event_type + created_at
-- This replaces the slow JSONB queries with lightning-fast indexed queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_user_type_time
ON low_level_events(user_id, event_type, created_at)
WHERE event_type IS NOT NULL;

-- App name index for analysis queries  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_user_app_time
ON low_level_events(user_id, app_name, created_at)
WHERE app_name IS NOT NULL;

-- UI tree boolean index for quick filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_user_ui_tree_time
ON low_level_events(user_id, has_ui_tree, created_at)
WHERE has_ui_tree = true;

-- Screenshot timestamp index for timeline queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_screenshot_timestamp
ON low_level_events(user_id, screenshot_timestamp, created_at)
WHERE screenshot_timestamp IS NOT NULL;

-- Composite index for the most common query pattern
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_type_ui_tree
ON low_level_events(user_id, event_type, has_ui_tree, created_at)
WHERE event_type IS NOT NULL;

-- Add documentation
COMMENT ON INDEX idx_low_level_events_user_type_time IS
'Primary performance index - replaces slow payload->>type JSONB queries';

COMMENT ON INDEX idx_low_level_events_user_app_time IS
'App name filtering for workflow analysis';

COMMENT ON INDEX idx_low_level_events_user_ui_tree_time IS
'Quick UI tree existence check';

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Migration 4/4 complete: Added optimized indexes to low_level_events';
    RAISE NOTICE 'Performance improvement: JSONB queries now replaced with indexed columns';
    RAISE NOTICE 'Expected speedup: 100-1000x faster for type filtering queries';
END $$; 