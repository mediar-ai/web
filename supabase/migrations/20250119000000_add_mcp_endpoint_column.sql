-- Migration: Add mcp_endpoint column to workflow_executions table
-- Created: 2025-01-19
-- Description: Stores the machine's MCP endpoint URL for the execution

-- Add mcp_endpoint column to workflow_executions table
ALTER TABLE public.workflow_executions 
ADD COLUMN IF NOT EXISTS mcp_endpoint text;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_workflow_executions_mcp_endpoint 
ON public.workflow_executions(mcp_endpoint);

-- Add comment for documentation
COMMENT ON COLUMN public.workflow_executions.mcp_endpoint 
IS 'MCP endpoint URL for the assigned machine (e.g., https://mcp-server-1.ngrok.app)'; 