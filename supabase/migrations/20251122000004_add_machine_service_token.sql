-- Migration: Add service token to remote_machines
-- Created: 2025-11-22
-- Purpose: Enable machine-to-API authentication for workflow downloads

-- Add service_token column for machine authentication
ALTER TABLE remote_machines
ADD COLUMN service_token TEXT;

-- Create unique index (tokens must be unique across all machines)
CREATE UNIQUE INDEX idx_remote_machines_service_token ON remote_machines(service_token) 
WHERE service_token IS NOT NULL;

COMMENT ON COLUMN remote_machines.service_token IS 'Long-lived service token for VM-to-API authentication (used for workflow downloads)';

-- Generate secure random tokens for existing machines
-- Using encode(gen_random_bytes(32), 'hex') generates 64-character hex string
UPDATE remote_machines
SET service_token = encode(gen_random_bytes(32), 'hex')
WHERE service_token IS NULL;

-- Function: Verify service token and get machine info
CREATE OR REPLACE FUNCTION verify_machine_service_token(
  p_service_token TEXT
) RETURNS TABLE (
  machine_id BIGINT,
  machine_name TEXT,
  is_valid BOOLEAN
) AS $$
  SELECT 
    id,
    name,
    TRUE as is_valid
  FROM remote_machines
  WHERE service_token = p_service_token
    AND status = 'active'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

COMMENT ON FUNCTION verify_machine_service_token IS 'Verify machine service token and return machine details';

-- Log token generation
DO $$
DECLARE
  token_count INT;
BEGIN
  SELECT COUNT(*) INTO token_count
  FROM remote_machines
  WHERE service_token IS NOT NULL;
  
  RAISE NOTICE 'Generated service tokens for % machines', token_count;
  RAISE NOTICE '⚠️  IMPORTANT: These tokens grant workflow download access. Rotate periodically.';
END $$;
