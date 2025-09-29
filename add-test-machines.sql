-- Insert test machines into remote_machines table
-- Run this in Supabase SQL editor

INSERT INTO remote_machines (
  name,
  description,
  mcp_endpoint,
  management_endpoint,
  health_endpoint,
  machine_type,
  status,
  health_status,
  capabilities,
  max_concurrent_executions,
  priority,
  region,
  tags
) VALUES
(
  'Azure VM 01',
  'Primary Azure virtual machine for workflow execution',
  'http://your-azure-vm-ip:8080/mcp',
  'http://your-azure-vm-ip:3000',
  'http://your-azure-vm-ip:3000/health',
  'windows_vm',
  'active',
  'healthy',
  '{"windows": true, "office": true, "browser": true}'::jsonb,
  2,
  1,
  'us-west-2',
  ARRAY['production', 'azure', 'primary']
),
(
  'Azure VM 02',
  'Secondary Azure virtual machine for workflow execution',
  'http://your-azure-vm-ip-2:8080/mcp',
  'http://your-azure-vm-ip-2:3000',
  'http://your-azure-vm-ip-2:3000/health',
  'windows_vm',
  'active',
  'healthy',
  '{"windows": true, "office": true, "browser": true}'::jsonb,
  2,
  2,
  'us-west-2',
  ARRAY['production', 'azure', 'secondary']
),
(
  'Local Test Machine',
  'Local development machine for testing',
  'http://localhost:8080/mcp',
  'http://localhost:3000',
  'http://localhost:3000/health',
  'windows_vm',
  'active',
  'unknown',
  '{"windows": true, "office": true, "browser": true}'::jsonb,
  1,
  5,
  'local',
  ARRAY['development', 'local']
);

-- If you have actual machine endpoints, replace the URLs above with real ones
-- For example:
-- UPDATE remote_machines
-- SET mcp_endpoint = 'http://13.77.110.245:8080/mcp',
--     management_endpoint = 'http://13.77.110.245:3000',
--     health_endpoint = 'http://13.77.110.245:3000/health'
-- WHERE name = 'Azure VM 01';