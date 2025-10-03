import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('=== DEBUGGING WORKFLOW ISSUES ===\n');

// 1. Check testingstuff workflow (ID 74)
console.log('1. TESTINGSTUFF WORKFLOW:\n');
const { data: testingstuffExecs } = await supabase
  .from('workflow_executions')
  .select('id, assigned_machine_id, assignment_reason, status, created_at')
  .eq('workflow_id', 74)
  .order('created_at', { ascending: false })
  .limit(5);

if (testingstuffExecs) {
  for (const exec of testingstuffExecs) {
    console.log(`  Execution ${exec.id}:`);
    console.log(`    Machine: ${exec.assigned_machine_id}`);
    console.log(`    Reason: ${exec.assignment_reason}`);
    console.log(`    Status: ${exec.status}`);
    console.log(`    Time: ${new Date(exec.created_at).toLocaleTimeString()}`);
    console.log('');
  }
}

// Check preferred machine for testingstuff
const { data: testingstuffAssignment } = await supabase
  .from('workflow_machine_assignments')
  .select('machine_id, assignment_type, remote_machines(name, status, health_status)')
  .eq('workflow_id', 74)
  .eq('is_active', true)
  .single();

if (testingstuffAssignment) {
  const machine = Array.isArray(testingstuffAssignment.remote_machines)
    ? testingstuffAssignment.remote_machines[0]
    : testingstuffAssignment.remote_machines;
  console.log(`  Preferred Machine: ${machine.name} (ID: ${testingstuffAssignment.machine_id})`);
  console.log(`  Status: ${machine.status} / ${machine.health_status}`);
  console.log('  ⚠️  Machine is unhealthy - that\'s why it\'s not being used!\n');
}

// 2. Check UIAutomation workflow (ID 73)
console.log('2. UIAUTOMATION STILL WORKING WORKFLOW:\n');

const { data: uiautomation } = await supabase
  .from('deployed_workflows_with_sequence')
  .select('id, name, cron_expression, cron_enabled, cron_timezone, last_scheduled_execution, status')
  .eq('id', 73)
  .single();

if (uiautomation) {
  console.log(`  Workflow: ${uiautomation.name}`);
  console.log(`  Status: ${uiautomation.status}`);
  console.log(`  Cron Enabled: ${uiautomation.cron_enabled}`);
  console.log(`  Cron Expression: ${uiautomation.cron_expression}`);
  console.log(`  Last Execution: ${uiautomation.last_scheduled_execution || 'Never'}`);

  if (uiautomation.last_scheduled_execution) {
    const lastExec = new Date(uiautomation.last_scheduled_execution);
    const minsSince = Math.floor((Date.now() - lastExec.getTime()) / 60000);
    console.log(`  Minutes Since Last Exec: ${minsSince}`);
  }
  console.log('');
}

// Check recent executions for UIAutomation
const { data: uiautomationExecs } = await supabase
  .from('workflow_executions')
  .select('id, client_id, assigned_machine_id, status, created_at')
  .eq('workflow_id', 73)
  .order('created_at', { ascending: false })
  .limit(3);

if (uiautomationExecs) {
  console.log('  Recent executions:');
  for (const exec of uiautomationExecs) {
    console.log(`    ${new Date(exec.created_at).toLocaleString()}: ${exec.status} (${exec.client_id}) - Machine ${exec.assigned_machine_id}`);
  }
  console.log('');
}

// 3. Check all machine statuses
console.log('3. MACHINE HEALTH STATUS:\n');
const { data: machines } = await supabase
  .from('remote_machines')
  .select('id, name, status, health_status, last_health_check')
  .order('id');

if (machines) {
  for (const machine of machines) {
    const healthCheck = machine.last_health_check
      ? `${Math.floor((Date.now() - new Date(machine.last_health_check).getTime()) / 60000)} mins ago`
      : 'Never';
    console.log(`  Machine ${machine.id}: ${machine.name}`);
    console.log(`    Status: ${machine.status} / Health: ${machine.health_status}`);
    console.log(`    Last Check: ${healthCheck}`);
    console.log('');
  }
}

process.exit(0);
