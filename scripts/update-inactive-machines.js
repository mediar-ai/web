// Script to mark deleted Azure machines as inactive in Supabase
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function updateInactiveMachines() {
  console.log('Updating deleted machines to inactive status...\n');

  // First, let's check what machines exist
  const { data: existingMachines, error: fetchError } = await supabase
    .from('remote_machines')
    .select('*')
    .limit(5);

  if (fetchError) {
    console.error('Error fetching machines:', fetchError);
  } else if (existingMachines && existingMachines.length > 0) {
    console.log('Sample machine columns:', Object.keys(existingMachines[0]));
    console.log('Sample machines:');
    existingMachines.forEach(m => {
      console.log(`  - ${m.name || 'No name'}: ${m.ip_address} (${m.status})`);
    });
  }
  console.log('\n---\n');

  // List of machines that were deleted - identify by name or endpoint patterns
  const deletedMachinePatterns = [
    { pattern: '%172.171.201.185%', name: 'test-mcp-avd' },
    { pattern: '%172.178.65.145%', name: 'Azure 092825' },
    { pattern: '%40.71.113.226%', name: 'Azure 092625 telemetry' },
    { pattern: '%20.36.178.60%', name: 'Azure VM Old' },
    { pattern: '%test-mcp%', name: 'Test MCP instances' },
    { pattern: '%092825%', name: 'September 28 2025 instances' },
    { pattern: '%092625%', name: 'September 26 2025 instances' },
  ];

  // Update each machine to inactive
  for (const machine of deletedMachinePatterns) {
    console.log(`Searching for ${machine.name} with pattern: ${machine.pattern}`);

    // Try to find by mcp_endpoint, management_endpoint, or health_endpoint containing the IP
    const { data, error } = await supabase
      .from('remote_machines')
      .update({
        status: 'inactive',
        last_health_check: null,
        updated_at: new Date().toISOString()
      })
      .or(`mcp_endpoint.ilike.${machine.pattern},management_endpoint.ilike.${machine.pattern},health_endpoint.ilike.${machine.pattern},name.ilike.${machine.pattern}`)
      .neq('status', 'inactive')
      .select();

    if (error) {
      console.error(`  ❌ Error updating ${machine.name}:`, error.message);
    } else if (data && data.length > 0) {
      console.log(`  ✅ Updated ${data.length} machine(s) matching ${machine.name}`);
      data.forEach(m => {
        console.log(`     - ${m.name}: ${m.mcp_endpoint || m.management_endpoint || 'no endpoint'}`);
      });
    } else {
      console.log(`  ⚠️  No active machines found for pattern: ${machine.pattern}`);
    }
  }

  // Also update machines from deleted resource groups
  console.log('\nUpdating machines from deleted resource groups...');

  const deletedResourceGroups = [
    'test-mcp-avd',
    'mcp-cluster-rg',
    'mcp-dev-cluster',
    'mcp-otel-09151348',
    'mcp-s3-cluster',
    'mcp-simple',
    'mcp-quick',
    'avd-mcp-aib'
  ];

  for (const rg of deletedResourceGroups) {
    const { data, error } = await supabase
      .from('remote_machines')
      .update({
        status: 'inactive',
        last_health_check: null,
        updated_at: new Date().toISOString()
      })
      .ilike('configuration', `%${rg}%`)
      .neq('status', 'inactive')
      .select();

    if (!error && data && data.length > 0) {
      console.log(`  ✅ Updated ${data.length} machine(s) from resource group: ${rg}`);
    }
  }

  // Show final status
  console.log('\n=== Final Status ===');

  const { data: activeMachines } = await supabase
    .from('remote_machines')
    .select('name, mcp_endpoint, management_endpoint, status')
    .eq('status', 'active');

  console.log('\nActive machines remaining:');
  if (activeMachines && activeMachines.length > 0) {
    activeMachines.forEach(m => {
      console.log(`  ✅ ${m.name}: ${m.mcp_endpoint || m.management_endpoint || 'no endpoint'}`);
    });
  } else {
    console.log('  (none)');
  }

  const { data: inactiveMachines } = await supabase
    .from('remote_machines')
    .select('name, mcp_endpoint, management_endpoint, status')
    .eq('status', 'inactive')
    .order('updated_at', { ascending: false })
    .limit(10);

  console.log('\nRecently inactivated machines:');
  if (inactiveMachines && inactiveMachines.length > 0) {
    inactiveMachines.forEach(m => {
      console.log(`  ❌ ${m.name}: ${m.mcp_endpoint || m.management_endpoint || 'no endpoint'}`);
    });
  } else {
    console.log('  (none)');
  }
}

updateInactiveMachines().catch(console.error);