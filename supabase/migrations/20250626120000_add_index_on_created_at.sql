-- Add a composite index on user_id and created_at for performance.
-- The explicit naming of the index follows Supabase conventions and ensures clarity.
-- Using 'DESC' on created_at optimizes for the most common query pattern (fetching recent events).
-- Adding 'id DESC' as a third column ensures the sort order is fully deterministic, preventing pagination issues.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_low_level_events_user_id_created_at_id 
ON public.low_level_events (user_id, created_at DESC, id DESC); 