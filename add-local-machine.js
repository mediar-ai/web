require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function addLocalMachine() {
  // First check if we have any machines
  const { data: existingMachines, error: checkError } = await supabase
    .from('machines')
    .select('id, name, mcp_endpoint')
    .order('id');

  console.log('Existing machines:', existingMachines);

  // Add a local MCP server endpoint
  const { data, error } = await supabase
    .from('machines')
    .upsert({
      id: 1,
      name: 'Local MCP Server',
      mcp_endpoint: 'http://localhost:3001/api',
      is_available: true,
      capabilities: ['workflow_execution'],
      status: 'online'
    }, { onConflict: 'id' })
    .select();

  if (error) {
    console.error('Error adding machine:', error);
  } else {
    console.log('Added/Updated machine:', data);
  }

  // Check if any workflows are queued or stuck
  const { data: stuck } = await supabase
    .from('workflow_executions')
    .select('id, status')
    .in('status', ['queued', 'running'])
    .limit(10);

  if (stuck && stuck.length > 0) {
    console.log('\nWorkflows to process:', stuck);

    // Reset stuck workflows to queued
    for (const exec of stuck) {
      if (exec.status === 'running') {
        const { error: updateError } = await supabase
          .from('workflow_executions')
          .update({
            status: 'queued',
            started_at: null,
            error_message: null
          })
          .eq('id', exec.id);

        if (updateError) {
          console.error(`Failed to reset ${exec.id}:`, updateError);
        } else {
          console.log(`Reset execution ${exec.id} to queued`);
        }
      }
    }
  }

  process.exit(0);
}

addLocalMachine().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});