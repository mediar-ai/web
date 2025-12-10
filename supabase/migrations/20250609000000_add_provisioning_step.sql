-- Migration: Add provisioning_step and azure_resource_id columns
-- Created: 2025-06-09
-- Description: Allows the dashboard to show real-time provisioning progress via Inngest
--              and track the Azure resource ID for management operations

-- Add provisioning_step column to track VM provisioning progress
ALTER TABLE public.remote_machines
ADD COLUMN IF NOT EXISTS provisioning_step JSONB;

-- Add azure_resource_id column to track the Azure resource
ALTER TABLE public.remote_machines
ADD COLUMN IF NOT EXISTS azure_resource_id VARCHAR(512);

-- Add index for querying provisioning status
CREATE INDEX IF NOT EXISTS idx_remote_machines_provisioning_step
ON public.remote_machines USING GIN(provisioning_step);

-- Add index for azure_resource_id lookups
CREATE INDEX IF NOT EXISTS idx_remote_machines_azure_resource_id
ON public.remote_machines(azure_resource_id);

COMMENT ON COLUMN public.remote_machines.provisioning_step IS 'Tracks VM provisioning progress: {step: string, status: string, message: string, timestamp: ISO timestamp}';
COMMENT ON COLUMN public.remote_machines.azure_resource_id IS 'Full Azure resource ID for VM management operations';
