-- Migration: Prevent duplicate UI tree events
-- This migration adds constraints and indexes to prevent duplicate events with identical timestamps

-- 1. Add a hash column for payload deduplication
ALTER TABLE public.low_level_events 
ADD COLUMN IF NOT EXISTS payload_hash TEXT;

-- 2. Create function to generate consistent payload hash
CREATE OR REPLACE FUNCTION generate_payload_hash(payload_data JSONB)
RETURNS TEXT AS $$
BEGIN
    -- Create consistent hash by sorting JSON keys
    RETURN md5(payload_data::text);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Populate hash for existing records
UPDATE public.low_level_events 
SET payload_hash = generate_payload_hash(payload)
WHERE payload_hash IS NULL;

-- 4. Add trigger to automatically set hash on new inserts
CREATE OR REPLACE FUNCTION set_payload_hash()
RETURNS TRIGGER AS $$
BEGIN
    NEW.payload_hash := generate_payload_hash(NEW.payload);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_payload_hash
    BEFORE INSERT ON public.low_level_events
    FOR EACH ROW
    EXECUTE FUNCTION set_payload_hash();

-- 5. Create unique index to prevent duplicate payloads within session/user
-- This allows same event from different users/sessions but prevents duplicates within same context
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_payload_per_session
ON public.low_level_events (user_id, session_id, payload_hash);

-- 6. Add index for fast duplicate checking during ingest
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_recent_hash
ON public.low_level_events (user_id, session_id, created_at DESC, payload_hash);

-- 7. Add comment explaining the deduplication strategy
COMMENT ON COLUMN public.low_level_events.payload_hash IS 
'MD5 hash of payload for fast duplicate detection. Combined with user_id and session_id to prevent duplicate events.';

-- Log migration completion
DO $$
BEGIN
    RAISE NOTICE 'Migration complete: Added payload deduplication to low_level_events table';
END $$; 