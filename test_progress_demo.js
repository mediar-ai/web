const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://eshwntsgsputksqamckh.supabase.co';
const supabaseKey = '***REMOVED***';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testProgressUpdates() {
  console.log('🧪 Testing progress update functionality...');
  
  try {
    // Step 1: Create a test execution
    console.log('1. Creating test execution...');
    const { data: execution, error: createError } = await supabase
      .from('workflow_executions')
      .insert({
        workflow_id: 1, // Assuming workflow ID 1 exists
        client_id: 'test-progress-demo',
        status: 'running',
        execution_params: { test: true },
        modal_call_id: `test_${Date.now()}`,
        total_steps: 5,
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) {
      throw new Error(`Failed to create test execution: ${createError.message}`);
    }

    console.log(`✅ Created execution ${execution.id}`);

    // Step 2: Simulate progress updates
    const steps = [
      { progress: 20, step: 0, description: "Initializing browser automation" },
      { progress: 40, step: 1, description: "Navigating to Best Plan Pro website" },
      { progress: 60, step: 2, description: "Filling out form data" },
      { progress: 80, step: 3, description: "Submitting quote request" },
      { progress: 100, step: 4, description: "Extracting results" }
    ];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      console.log(`2.${i+1}. Updating progress to ${step.progress}% - ${step.description}`);
      
      // Update progress using the function we created
      const { data: updateResult, error: updateError } = await supabase.rpc('update_execution_progress', {
        p_execution_id: execution.id,
        p_progress_percentage: step.progress,
        p_current_step_index: step.step,
        p_current_step_description: step.description
      });

      if (updateError) {
        console.error(`❌ Failed to update progress: ${updateError.message}`);
      } else {
        console.log(`✅ Progress updated to ${step.progress}%`);
      }

      // Wait 2 seconds between updates to simulate real execution
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Step 3: Mark as completed
    console.log('3. Marking execution as completed...');
    const { error: completeError } = await supabase
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        execution_duration_seconds: Math.floor((Date.now() - new Date(execution.created_at).getTime()) / 1000)
      })
      .eq('id', execution.id);

    if (completeError) {
      console.error(`❌ Failed to complete execution: ${completeError.message}`);
    } else {
      console.log('✅ Execution marked as completed');
    }

    // Step 4: Query the live execution status view
    console.log('4. Querying live execution status...');
    const { data: liveStatus, error: queryError } = await supabase
      .from('live_execution_status')
      .select('*')
      .eq('id', execution.id)
      .single();

    if (queryError) {
      console.error(`❌ Failed to query live status: ${queryError.message}`);
    } else {
      console.log('✅ Live status:', {
        id: liveStatus.id,
        workflow_name: liveStatus.workflow_name,
        status: liveStatus.status,
        progress_percentage: liveStatus.progress_percentage,
        current_step_description: liveStatus.current_step_description,
        estimated_seconds_remaining: liveStatus.estimated_seconds_remaining
      });
    }

    console.log('\n🎉 Progress update test completed successfully!');
    console.log('You can now view the live execution status in the deployment dashboard.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testProgressUpdates();
