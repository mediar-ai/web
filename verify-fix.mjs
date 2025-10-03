import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('=== VERIFYING FIX ===\n');

// Check the most recent executions for testingstuff (74) and UIAutomation (73)
const { data: recentExecs } = await supabase
  .from('workflow_executions')
  .select('id, workflow_id, assigned_machine_id, assignment_reason, status, created_at')
  .in('workflow_id', [73, 74])
  .order('created_at', { ascending: false })
  .limit(6);

if (recentExecs) {
  console.log('Recent Executions:\n');
  for (const exec of recentExecs) {
    const workflowName = exec.workflow_id === 73 ? 'UIAutomation' : 'testingstuff';
    const time = new Date(exec.created_at).toLocaleTimeString();
    console.log(`${time} - ${workflowName} (${exec.workflow_id}):`);
    console.log(`  Execution: ${exec.id}`);
    console.log(`  Machine: ${exec.assigned_machine_id}`);
    console.log(`  Status: ${exec.status}`);
    console.log(`  Reason: ${exec.assignment_reason}`);
    console.log('');
  }
}

// Check if Machine 13 is being used
const machine13Count = recentExecs?.filter(e => e.assigned_machine_id === 13).length || 0;
if (machine13Count > 0) {
  console.log(`✅ SUCCESS: ${machine13Count} execution(s) using Machine 13 (preferred)!`);
} else {
  console.log(`⚠️  Still using other machines - next cron trigger should fix this`);
}

process.exit(0);
