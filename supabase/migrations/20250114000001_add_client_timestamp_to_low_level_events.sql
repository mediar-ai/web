-- Add client_timestamp column to low_level_events for better performance
-- This extracts timestamps from JSON payload into a dedicated indexed column

-- Step 1: Add the new column
ALTER TABLE public.low_level_events 
ADD COLUMN IF NOT EXISTS client_timestamp TIMESTAMPTZ;

-- Step 2: Populate existing data by extracting timestamps from payload
-- Handle different payload structures safely
UPDATE public.low_level_events 
SET client_timestamp = CASE 
    -- Direct timestamp in payload
    WHEN payload->>'timestamp' IS NOT NULL 
    THEN (payload->>'timestamp')::timestamptz
    
    -- Nested timestamp in payload.timestamp  
    WHEN payload->'payload'->>'timestamp' IS NOT NULL 
    THEN (payload->'payload'->>'timestamp')::timestamptz
    
    -- Fallback to created_at if no timestamp found
    ELSE created_at
END
WHERE client_timestamp IS NULL;

-- Step 3: Add performance indexes
-- Index for timestamp-based queries
CREATE INDEX IF NOT EXISTS idx_low_level_events_client_timestamp 
ON public.low_level_events(client_timestamp);

-- Composite index for user + timestamp queries (most common pattern)
CREATE INDEX IF NOT EXISTS idx_low_level_events_user_timestamp 
ON public.low_level_events(user_id, client_timestamp);

-- Composite index for user + type + timestamp (for UI tree queries)
CREATE INDEX IF NOT EXISTS idx_low_level_events_user_type_timestamp 
ON public.low_level_events(user_id, ((payload->'payload'->>'type')), client_timestamp);

-- Step 4: Add comment for documentation
COMMENT ON COLUMN public.low_level_events.client_timestamp IS 
'Extracted timestamp from payload for fast querying and ordering. Represents the actual time the event occurred on the client.';

-- Step 5: Add constraint to ensure client_timestamp is not null for new records
-- (We'll handle this in the application layer for now to avoid breaking existing flows) 