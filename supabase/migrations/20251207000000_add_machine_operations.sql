-- Migration: Add machine_operations table for audit trail
-- Tracks all VM lifecycle operations (start, stop, restart, deallocate, run_command, update_version)

CREATE TABLE IF NOT EXISTS machine_operations (
  id SERIAL PRIMARY KEY,
  machine_id INTEGER REFERENCES remote_machines(id) ON DELETE CASCADE,
  operation_type VARCHAR(50) NOT NULL,
  operation_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  initiated_by VARCHAR(255),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  details JSONB DEFAULT '{}',

  CONSTRAINT valid_operation_type CHECK (
    operation_type IN ('start', 'stop', 'restart', 'deallocate', 'run_command', 'update_version')
  ),
  CONSTRAINT valid_status CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'timeout')
  )
);

-- Index for fast lookups by machine
CREATE INDEX IF NOT EXISTS idx_machine_operations_machine_id
  ON machine_operations(machine_id);

-- Index for operation ID lookups
CREATE INDEX IF NOT EXISTS idx_machine_operations_operation_id
  ON machine_operations(operation_id);

-- Index for recent operations (for dashboard)
CREATE INDEX IF NOT EXISTS idx_machine_operations_started_at
  ON machine_operations(started_at DESC);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_machine_operations_status
  ON machine_operations(status);

-- Composite index for machine + recent operations
CREATE INDEX IF NOT EXISTS idx_machine_operations_machine_recent
  ON machine_operations(machine_id, started_at DESC);

-- Add comment
COMMENT ON TABLE machine_operations IS 'Audit trail for all VM lifecycle operations';
COMMENT ON COLUMN machine_operations.operation_id IS 'Unique UUID for tracking this specific operation';
COMMENT ON COLUMN machine_operations.initiated_by IS 'User ID (Clerk) or "system" for automated operations';
COMMENT ON COLUMN machine_operations.details IS 'JSON containing command output, Azure response, or other operation-specific data';

-- Add terraform_key column to remote_machines if not exists
-- This is used to generate VNC URLs for each machine
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'remote_machines' AND column_name = 'terraform_key'
  ) THEN
    ALTER TABLE remote_machines ADD COLUMN terraform_key VARCHAR(100);
    COMMENT ON COLUMN remote_machines.terraform_key IS 'Terraform resource key (e.g., vm2) used for VNC gateway routing';
  END IF;
END $$;

-- Add power_state column to remote_machines for caching Azure state
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'remote_machines' AND column_name = 'power_state'
  ) THEN
    ALTER TABLE remote_machines ADD COLUMN power_state VARCHAR(20) DEFAULT 'unknown';
    COMMENT ON COLUMN remote_machines.power_state IS 'Cached Azure VM power state (running, stopped, deallocated, etc.)';
  END IF;
END $$;

-- Add power_state_updated_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'remote_machines' AND column_name = 'power_state_updated_at'
  ) THEN
    ALTER TABLE remote_machines ADD COLUMN power_state_updated_at TIMESTAMPTZ;
    COMMENT ON COLUMN remote_machines.power_state_updated_at IS 'When the power_state was last updated from Azure';
  END IF;
END $$;
