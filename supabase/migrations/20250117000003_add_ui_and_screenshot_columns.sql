-- Migration 3: Add UI tree and screenshot columns
-- For quick checks without parsing JSONB

-- Add has_ui_tree boolean column
ALTER TABLE low_level_events 
ADD COLUMN IF NOT EXISTS has_ui_tree BOOLEAN DEFAULT FALSE;

-- Add screenshot_timestamp column
ALTER TABLE low_level_events 
ADD COLUMN IF NOT EXISTS screenshot_timestamp TIMESTAMPTZ;

-- Add comments explaining the purpose
COMMENT ON COLUMN low_level_events.has_ui_tree IS
'Boolean flag indicating if payload contains UI tree data - avoids parsing large JSONB';

COMMENT ON COLUMN low_level_events.screenshot_timestamp IS
'Extracted from payload.payload.event.screenshot_diff.after_timestamp for screenshot timing';

-- Log progress
DO $$
BEGIN
    RAISE NOTICE 'Migration 3/4 complete: Added has_ui_tree and screenshot_timestamp columns to low_level_events';
END $$; 