-- Update all machine names to match Guacamole connection names
-- Guacamole connections are named: MCP-{computer_name}
-- From terraform: MCP-mcp-fixed-otlp, MCP-mcp-vm2

-- First, let's see current state
SELECT id, name, mcp_endpoint FROM remote_machines ORDER BY id;

-- Update machine names to match Guacamole format
-- Assuming the machines are mcp-fixed-otlp and mcp-vm2
UPDATE remote_machines
SET name = 'MCP-mcp-fixed-otlp'
WHERE mcp_endpoint LIKE '%mcp-fixed-otlp%' OR name LIKE '%fixed%otlp%';

UPDATE remote_machines
SET name = 'MCP-mcp-vm2'
WHERE mcp_endpoint LIKE '%mcp-vm2%' OR name LIKE '%vm2%';

-- Verify the updates
SELECT id, name, mcp_endpoint FROM remote_machines ORDER BY id;
