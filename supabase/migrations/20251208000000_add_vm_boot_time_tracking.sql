-- Add VM boot time tracking columns
-- Track when provisioning started and when VM first became healthy

ALTER TABLE remote_machines
ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS first_healthy_at TIMESTAMPTZ;

-- Calculated field for boot time in seconds (for queries)
COMMENT ON COLUMN remote_machines.provisioned_at IS 'Timestamp when VM provisioning was initiated';
COMMENT ON COLUMN remote_machines.first_healthy_at IS 'Timestamp when health check first returned healthy';

-- Index for boot time analytics
CREATE INDEX IF NOT EXISTS idx_remote_machines_provisioned_at ON remote_machines(provisioned_at) WHERE provisioned_at IS NOT NULL;

-- Function to record first healthy timestamp (called from health check job)
CREATE OR REPLACE FUNCTION record_first_healthy(p_machine_id INTEGER)
RETURNS VOID AS $$
BEGIN
    UPDATE remote_machines
    SET first_healthy_at = NOW()
    WHERE id = p_machine_id
      AND first_healthy_at IS NULL
      AND health_status = 'healthy';
END;
$$ LANGUAGE plpgsql;

-- View for boot time metrics
CREATE OR REPLACE VIEW vm_boot_time_metrics AS
SELECT
    id,
    name,
    provisioned_at,
    first_healthy_at,
    CASE
        WHEN first_healthy_at IS NOT NULL AND provisioned_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (first_healthy_at - provisioned_at))
        ELSE NULL
    END AS boot_time_seconds,
    CASE
        WHEN first_healthy_at IS NOT NULL AND provisioned_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (first_healthy_at - provisioned_at)) / 60, 1)
        ELSE NULL
    END AS boot_time_minutes,
    machine_role,
    region,
    created_at
FROM remote_machines
WHERE provisioned_at IS NOT NULL
ORDER BY provisioned_at DESC;
