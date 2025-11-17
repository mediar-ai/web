-- Migration: Add Azure Resource ID for unique VM identification
-- Created: 2025-11-17
-- Description: Adds azure_resource_id column to remote_machines for guaranteed unique identification
--              Replaces tag-based matching (terraform:vmX) with Azure Resource IDs

-- Add azure_resource_id column
ALTER TABLE public.remote_machines
ADD COLUMN IF NOT EXISTS azure_resource_id TEXT;

-- Create unique index (allows NULL for non-Azure machines, but enforces uniqueness when present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_machines_azure_resource_id
ON public.remote_machines(azure_resource_id)
WHERE azure_resource_id IS NOT NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_remote_machines_azure_resource_id_not_null
ON public.remote_machines(azure_resource_id);

-- Add comment explaining the column
COMMENT ON COLUMN public.remote_machines.azure_resource_id IS
'Azure Resource ID (e.g., /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{name}). Unique identifier for Azure VMs managed by Terraform. NULL for non-Azure machines.';

-- =============================================================================
-- RPC Function: Upsert Remote Machine by Azure Resource ID
-- =============================================================================
CREATE OR REPLACE FUNCTION public.upsert_remote_machine_by_azure_id(
  p_azure_resource_id TEXT,
  p_name TEXT,
  p_mcp_endpoint TEXT,
  p_terraform_key TEXT DEFAULT NULL
) RETURNS SETOF public.remote_machines AS $$
DECLARE
  v_management_endpoint TEXT;
  v_health_endpoint TEXT;
  v_tags TEXT[];
BEGIN
  -- Derive other endpoints from MCP endpoint
  v_management_endpoint := regexp_replace(p_mcp_endpoint, '/mcp$', '');
  v_health_endpoint := regexp_replace(p_mcp_endpoint, '/mcp$', '/health');

  -- Build tags array
  IF p_terraform_key IS NOT NULL THEN
    v_tags := ARRAY['terraform:' || p_terraform_key];
  ELSE
    v_tags := '{}';
  END IF;

  -- Upsert by Azure Resource ID
  RETURN QUERY
  INSERT INTO public.remote_machines (
    azure_resource_id,
    name,
    mcp_endpoint,
    management_endpoint,
    health_endpoint,
    tags,
    status,
    machine_type,
    created_at,
    updated_at
  ) VALUES (
    p_azure_resource_id,
    p_name,
    p_mcp_endpoint,
    v_management_endpoint,
    v_health_endpoint,
    v_tags,
    'active',
    'windows_vm',
    NOW(),
    NOW()
  )
  ON CONFLICT (azure_resource_id)
  DO UPDATE SET
    name = EXCLUDED.name,
    mcp_endpoint = EXCLUDED.mcp_endpoint,
    management_endpoint = EXCLUDED.management_endpoint,
    health_endpoint = EXCLUDED.health_endpoint,
    tags = EXCLUDED.tags,
    status = 'active',
    updated_at = NOW()
  WHERE remote_machines.azure_resource_id = p_azure_resource_id
  RETURNING *;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON FUNCTION public.upsert_remote_machine_by_azure_id IS
'Inserts or updates a remote machine record using Azure Resource ID as the unique key. Used by Terraform to sync VM state to Supabase.';

-- Grant execute permission (adjust based on your security model)
GRANT EXECUTE ON FUNCTION public.upsert_remote_machine_by_azure_id TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_remote_machine_by_azure_id TO authenticated;
