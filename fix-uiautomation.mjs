import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Get the stuck execution
const { data: exec } = await supabase
  .from('workflow_executions')
  .select('id, workflow_id, assigned_machine_id')
  .eq('id', 10660)
  .single();

if (exec && exec.assigned_machine_id === 1) {
  // Reassign to machine 13 (the preferred one)
  const { error } = await supabase
    .from('workflow_executions')
    .update({
      assigned_machine_id: 13,
      mcp_endpoint: 'http://20.163.215.81:8080/mcp',
      assignment_reason: 'Reassigned to preferred machine 13 (was stuck on inactive machine 1)',
    })
    .eq('id', 10660);

  if (error) {
    console.log(`❌ Failed: ${error.message}`);
  } else {
    console.log(`✓ Reassigned execution 10660 to Machine 13 (MCP-STABLE-100125)`);
  }
} else {
  console.log('Execution already processed or not found');
}

process.exit(0);
