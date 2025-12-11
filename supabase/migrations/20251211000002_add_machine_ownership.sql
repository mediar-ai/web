-- Migration: Add ownership to remote machines
-- Created: 2025-12-11
-- Description: Adds owner_user_id and owner_org_id for simple IAM

-- Add ownership columns to remote_machines
ALTER TABLE public.remote_machines
ADD COLUMN IF NOT EXISTS owner_user_id text;

ALTER TABLE public.remote_machines
ADD COLUMN IF NOT EXISTS owner_org_id text;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_remote_machines_owner_user ON public.remote_machines(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_remote_machines_owner_org ON public.remote_machines(owner_org_id);

-- Function to get machines accessible by a user (their own + their org's)
CREATE OR REPLACE FUNCTION get_user_accessible_machines(
    p_user_id text,
    p_org_id text DEFAULT NULL
) RETURNS SETOF public.remote_machines AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.remote_machines
    WHERE
        -- User created it (personal VM)
        owner_user_id = p_user_id
        -- OR it belongs to user's org
        OR (p_org_id IS NOT NULL AND owner_org_id = p_org_id)
        -- OR it's a global machine
        OR is_global = true
    ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can access a machine
CREATE OR REPLACE FUNCTION user_can_access_machine(
    p_user_id text,
    p_org_id text,
    p_machine_id integer
) RETURNS boolean AS $$
DECLARE
    v_machine public.remote_machines;
BEGIN
    SELECT * INTO v_machine
    FROM public.remote_machines
    WHERE id = p_machine_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Global machines are accessible to all
    IF v_machine.is_global THEN
        RETURN true;
    END IF;

    -- User created it
    IF v_machine.owner_user_id = p_user_id THEN
        RETURN true;
    END IF;

    -- Belongs to user's org
    IF p_org_id IS NOT NULL AND v_machine.owner_org_id = p_org_id THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN public.remote_machines.owner_user_id IS 'Clerk user ID who created this machine';
COMMENT ON COLUMN public.remote_machines.owner_org_id IS 'Clerk org ID - all org members can access this machine';
COMMENT ON FUNCTION get_user_accessible_machines(text, text) IS 'Returns all machines a user can access (own + org + global)';
COMMENT ON FUNCTION user_can_access_machine(text, text, integer) IS 'Checks if a user can access a specific machine';
