import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const vmData = {
  name: 'mcp-s3-mount-test',
  description: 'MCP VM with dynamic version fetch, UX improvements, S3 mount',
  mcp_endpoint: 'http://172.191.93.174:8080/mcp',
  management_endpoint: 'http://172.191.93.174:8080',
  health_endpoint: 'http://172.191.93.174:8080/health',
  machine_type: 'windows_vm',
  region: 'eastus',
  tags: ['packer-built', 'dynamic-version', 'ux-improved'],
  capabilities: {
    ui_automation: true,
    browser_automation: true,
    s3_mount: true,
    telemetry: true,
    parsec_vdd: true
  },
  max_concurrent_executions: 1,
  priority: 5,
  status: 'active',
  health_status: 'healthy'
};

async function addVM() {
  try {
    // Check if VM already exists by name
    const { data: existing, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('name', vmData.name)
      .maybeSingle();

    if (fetchError) {
      throw fetchError;
    }

    if (existing) {
      console.log('VM already exists, updating...');
      const { data, error } = await supabase
        .from('remote_machines')
        .update(vmData)
        .eq('name', vmData.name)
        .select()
        .single();

      if (error) throw error;
      console.log('✅ VM updated successfully');
      console.log('   ID:', data.id);
      console.log('   Name:', data.name);
      console.log('   MCP Endpoint:', data.mcp_endpoint);
      console.log('   Health:', data.health_status);
    } else {
      console.log('Adding new VM to Supabase...');
      const { data, error } = await supabase
        .from('remote_machines')
        .insert([vmData])
        .select()
        .single();

      if (error) throw error;
      console.log('✅ VM added successfully');
      console.log('   ID:', data.id);
      console.log('   Name:', data.name);
      console.log('   MCP Endpoint:', data.mcp_endpoint);
      console.log('   Health:', data.health_status);
      console.log('   Image: mcp-full-20251010-112801');
      console.log('   MCP Version: v0.17.5');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

addVM();
