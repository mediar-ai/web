-- Update machine name to match Guacamole connection
UPDATE remote_machines 
SET name = 'MCP-mcp-vm2' 
WHERE id = 18;

-- Verify the update
SELECT id, name, mcp_endpoint, status FROM remote_machines WHERE id = 18;
