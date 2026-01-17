-- Migration: Add 'claiming' status to remote_machines constraint
-- Description: Updates CHECK constraint to allow 'claiming' status for warm pool VM claiming
-- Date: 2026-01-17
-- Context: Warm pool feature claims pool VMs by setting status='claiming' before starting them.
--          The existing constraint only allows: 'active', 'inactive', 'maintenance', 'failed'

-- =============================================================================
-- 1. Find and drop the old constraint
-- =============================================================================

-- The constraint was created inline with the column in the original migration,
-- so we need to find its name first. PostgreSQL generates a name like:
-- remote_machines_status_check or chk_<oid>

-- Drop the constraint (PostgreSQL auto-generates name for inline CHECK)
DO $$
DECLARE
    constraint_name text;
BEGIN
    -- Find the CHECK constraint on the status column
    SELECT conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'remote_machines'
    AND c.contype = 'c'  -- 'c' = check constraint
    AND pg_get_constraintdef(c.oid) LIKE '%status%';

    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.remote_machines DROP CONSTRAINT ' || constraint_name;
        RAISE NOTICE 'Dropped constraint: %', constraint_name;
    ELSE
        RAISE NOTICE 'No status CHECK constraint found to drop';
    END IF;
END;
$$;

-- =============================================================================
-- 2. Add new constraint with 'claiming' status
-- =============================================================================

ALTER TABLE public.remote_machines
ADD CONSTRAINT remote_machines_status_check
CHECK (status = ANY (ARRAY[
    'active'::text,
    'inactive'::text,
    'maintenance'::text,
    'failed'::text,
    'claiming'::text
]));

COMMENT ON CONSTRAINT remote_machines_status_check ON public.remote_machines
IS 'Validates VM status. States: active (running), inactive (stopped), maintenance (temp disabled), failed (error state), claiming (being assigned from warm pool).';

-- =============================================================================
-- Migration Complete
-- =============================================================================

-- Summary of changes:
-- 1. Dropped inline CHECK constraint on status column
-- 2. Added named constraint with 'claiming' status
--
-- Background:
-- - The warm pool feature pre-provisions trial VMs in 'inactive' state
-- - When a user requests a trial, we claim a pool VM by setting status='claiming'
-- - This prevents the constraint violation that was causing pool claims to fail silently
-- - After claiming, the VM is started and status changes to 'active'
--
-- Related Issue:
-- - Pool claim update failed with: "new row violates check constraint remote_machines_status_check"
-- - Root cause: 'claiming' was not in the allowed values
