-- Add mcp_version column to remote_machines table to track MCP agent version
ALTER TABLE remote_machines ADD COLUMN IF NOT EXISTS mcp_version TEXT;

-- Create index for version queries
CREATE INDEX IF NOT EXISTS idx_remote_machines_mcp_version ON remote_machines(mcp_version);

-- Add comment
COMMENT ON COLUMN remote_machines.mcp_version IS 'MCP agent version running on this machine (e.g., "0.1.23"), captured from /health endpoint';
