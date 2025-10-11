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

async function checkAllVMs() {
  try {
    const { data: machines, error } = await supabase
      .from('remote_machines')
      .select('id, name, status, health_status, mcp_endpoint, updated_at')
      .order('updated_at', { ascending: false });

    if (error) throw error;

    console.log('\n📊 All VMs in Supabase:\n');
    machines.forEach(m => {
      const statusIcon = m.status === 'active' ? '🟢' : '🔴';
      const healthIcon = m.health_status === 'healthy' ? '✅' : '❌';
      console.log(`${statusIcon} ${healthIcon} [ID:${m.id}] ${m.name}`);
      console.log(`   Status: ${m.status || 'unknown'}, Health: ${m.health_status || 'unknown'}`);
      console.log(`   Endpoint: ${m.mcp_endpoint}`);
      console.log(`   Updated: ${m.updated_at}\n`);
    });

    console.log(`Total machines: ${machines.length}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAllVMs();
