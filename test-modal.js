const axios = require('axios');

// Test Modal API integration
async function testModalAPI() {
  const MODAL_API_URL = process.env.MODAL_API_URL || 'https://api.modal.com';
  const MODAL_TOKEN = process.env.MODAL_TOKEN;

  if (!MODAL_TOKEN) {
    console.log('❌ MODAL_TOKEN not set - using mock execution');
    return;
  }

  try {
    // Test 1: Check queue status
    console.log('🔍 Testing Modal queue status...');
    const queueResponse = await axios.post(`${MODAL_API_URL}/v1/functions/call`, {
      function_id: 'mediar-ai/main::get_workflow_queue_status',
      args: []
    }, {
      headers: {
        'Authorization': `Bearer ${MODAL_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Queue status response:', queueResponse.data);

    // Test 2: Test workflow execution (dry run)
    console.log('\n🚀 Testing workflow execution...');
    const testParams = {
      workflow_id: 1,
      execution_id: 'test-123',
      steps: [
        {
          action: 'navigate',
          url: 'https://google.com',
          description: 'Test navigation'
        }
      ],
      parameters: {
        test: 'value'
      }
    };

    const execResponse = await axios.post(`${MODAL_API_URL}/v1/functions/call`, {
      function_id: 'mediar-ai/main::execute_workflow',
      args: [testParams]
    }, {
      headers: {
        'Authorization': `Bearer ${MODAL_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Execution response:', execResponse.data);

  } catch (error) {
    console.error('❌ Modal API Error:', error.response?.data || error.message);
  }
}

testModalAPI().catch(console.error);
