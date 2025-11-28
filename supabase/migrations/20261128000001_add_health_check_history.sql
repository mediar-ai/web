-- Migration: Add health check history for rolling window uptime calculation
-- Created: 2026-11-28
-- Description: Stores individual health check results to calculate 24h rolling uptime percentage

-- =============================================================================
-- Health Check History Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.health_check_history (
    id BIGSERIAL PRIMARY KEY,
    machine_id INTEGER NOT NULL REFERENCES public.remote_machines(id) ON DELETE CASCADE,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_healthy BOOLEAN NOT NULL,
    response_time_ms INTEGER,
    status_code INTEGER,
    error_message TEXT
);

-- Index for efficient 24h window queries
CREATE INDEX IF NOT EXISTS idx_health_check_history_machine_time
ON public.health_check_history(machine_id, checked_at DESC);

-- Index for cleanup of old records
CREATE INDEX IF NOT EXISTS idx_health_check_history_checked_at
ON public.health_check_history(checked_at);

-- =============================================================================
-- Function to calculate 24h rolling uptime percentage
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_machine_uptime_24h(p_machine_id INTEGER)
RETURNS NUMERIC AS $$
DECLARE
    v_total INTEGER;
    v_healthy INTEGER;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE is_healthy = true)
    INTO v_total, v_healthy
    FROM public.health_check_history
    WHERE machine_id = p_machine_id
    AND checked_at > NOW() - INTERVAL '24 hours';

    IF v_total = 0 THEN
        RETURN NULL;
    END IF;

    RETURN ROUND((v_healthy::NUMERIC / v_total::NUMERIC) * 100, 1);
END;
$$ LANGUAGE plpgsql STABLE;

-- =============================================================================
-- Function to cleanup old health check records (keep 7 days)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_health_checks()
RETURNS INTEGER AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    DELETE FROM public.health_check_history
    WHERE checked_at < NOW() - INTERVAL '7 days';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- RLS Policies
-- =============================================================================
ALTER TABLE public.health_check_history ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to health_check_history"
ON public.health_check_history
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can read health_check_history"
ON public.health_check_history
FOR SELECT
TO authenticated
USING (true);

COMMENT ON TABLE public.health_check_history IS 'Stores individual health check results for calculating rolling uptime percentage';
COMMENT ON FUNCTION public.get_machine_uptime_24h IS 'Returns 24-hour rolling uptime percentage for a machine';
COMMENT ON FUNCTION public.cleanup_old_health_checks IS 'Removes health check records older than 7 days';
