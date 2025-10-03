import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data } = await supabase
  .from('workflow_executions')
  .select('id, workflow_id, assigned_machine_id, assignment_reason, created_at')
  .in('workflow_id', [73, 74])
  .order('created_at', { ascending: false })
  .limit(4);

console.log('\n=== LATEST EXECUTIONS ===\n');
if (data) {
  for (const e of data) {
    const wf = e.workflow_id === 73 ? 'UIAutomation' : 'testingstuff';
    console.log(`${new Date(e.created_at).toLocaleTimeString()} - ${wf}:`);
    console.log(`  Execution ${e.id} on Machine ${e.assigned_machine_id}`);
    console.log(`  ${e.assignment_reason}`);
    console.log('');
  }

  const usingMachine13 = data.filter(e => e.assigned_machine_id === 13);
  if (usingMachine13.length > 0) {
    console.log(`✅ SUCCESS! ${usingMachine13.length} execution(s) now using Machine 13!`);
  } else {
    console.log('⚠️  Still not using Machine 13');
  }
}

process.exit(0);
