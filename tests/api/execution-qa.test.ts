/**
 * Test for execution Q&A endpoint
 * Run with: npx tsx tests/api/execution-qa.test.ts
 */

import { createClient } from '@supabase/supabase-js';

async function testExecutionQA() {
  console.log('🧪 Testing Execution Q&A Endpoint\n');

  const executionId = 12374; // Use the execution from the screenshot

  // Test 1: Check if execution exists
  console.log('📌 Test 1: Verify execution exists in database');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing env vars');
    console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗');
    console.log('SUPABASE_SERVICE_KEY:', supabaseKey ? '✓' : '✗');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: execution, error } = await supabase
    .from('workflow_executions')
    .select('id, status, workflow_id, results')
    .eq('id', executionId)
    .single();

  if (error) {
    console.error('❌ Failed to fetch execution:', error);
    process.exit(1);
  }

  if (!execution) {
    console.error('❌ Execution not found');
    process.exit(1);
  }

  console.log('✅ Execution found:');
  console.log('   ID:', execution.id);
  console.log('   Status:', execution.status);
  console.log('   Workflow ID:', execution.workflow_id);
  console.log('   Has results:', !!execution.results);

  if (execution.results) {
    console.log('   Results type:', typeof execution.results);
    console.log('   Results keys:', Object.keys(execution.results).slice(0, 5).join(', '));
  }

  // Test 2: Check extractExecutionData
  console.log('\n📌 Test 2: Test extractExecutionData function');
  try {
    const { extractExecutionData } = await import('@/lib/execution-query-tools');
    const executionData = execution.results ? extractExecutionData(execution.results) : null;

    if (!executionData) {
      console.error('❌ extractExecutionData returned null');
    } else {
      console.log('✅ extractExecutionData succeeded');
      console.log('   Execution data type:', typeof executionData);
      console.log('   Execution data keys:', Object.keys(executionData).slice(0, 5).join(', '));
    }
  } catch (error) {
    console.error('❌ extractExecutionData failed:', error);
  }

  // Test 3: Call the API endpoint
  console.log('\n📌 Test 3: Call Q&A API endpoint');

  const apiUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const endpoint = `${apiUrl}/api/ai/execution-qa`;

  console.log('   Endpoint:', endpoint);
  console.log('   Execution ID:', executionId);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        executionId,
        messages: [
          { role: 'user', content: 'Were there any errors in this execution?' }
        ]
      })
    });

    console.log('   Response status:', response.status);
    console.log('   Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API request failed:', errorText);
      process.exit(1);
    }

    // Check if it's a streaming response
    const contentType = response.headers.get('content-type');
    console.log('   Content-Type:', contentType);

    if (contentType?.includes('text/event-stream') || contentType?.includes('text/plain')) {
      console.log('✅ Streaming response detected');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let receivedChunks = 0;
      let totalBytes = 0;

      if (reader) {
        console.log('\n📊 Streaming data:');

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          receivedChunks++;
          totalBytes += value.length;

          const chunk = decoder.decode(value, { stream: true });
          console.log(`   Chunk ${receivedChunks} (${value.length} bytes):`, chunk.substring(0, 100));
        }

        console.log(`\n✅ Received ${receivedChunks} chunks (${totalBytes} bytes total)`);

        if (receivedChunks === 0 || totalBytes === 0) {
          console.error('❌ WARNING: Response was empty!');
        }
      }
    } else {
      const text = await response.text();
      console.log('   Response body:', text.substring(0, 200));
    }

  } catch (error) {
    console.error('❌ API request failed:', error);
    process.exit(1);
  }

  console.log('\n🎉 All tests completed');
}

// Load env vars
require('dotenv').config({ path: '.env.local' });

testExecutionQA().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
