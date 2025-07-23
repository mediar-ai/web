-- Remove redundant client_timestamp column and indexes
-- We're keeping created_at which already contains the client timestamp

-- Drop indexes that use client_timestamp
DROP INDEX IF EXISTS idx_low_level_events_client_timestamp;
DROP INDEX IF EXISTS idx_low_level_events_user_timestamp;
DROP INDEX IF EXISTS idx_low_level_events_user_type_timestamp;

-- Drop the redundant column
ALTER TABLE low_level_events DROP COLUMN IF EXISTS client_timestamp;

-- Add optimized JSONB index for type filtering performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_payload_type 
ON low_level_events USING btree (user_id, (payload->'payload'->>'type'), created_at);

-- Add documentation
COMMENT ON COLUMN low_level_events.created_at IS 
'Client timestamp from payload.timestamp when available, server time as fallback. Represents when the event actually occurred.'; 