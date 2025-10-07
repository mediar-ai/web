#!/usr/bin/env node

/**
 * Test Q&A Endpoint Locally
 * Tests the actual API endpoint with real data
 */

const { createClient } = require('@supabase/supabase-js');

async function testQAEndpoint() {
  console.log('🧪 Testing Q&A Endpoint\n');

  // Load env
  require('dotenv').config({ path: '.env.local' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  console.log('✅ Supabase credentials loaded\n');

  // Test 1: Check if execution exists
  console.log('📌 Test 1: Fetch execution from database');
  const supabase = createClient(supabaseUrl, supabaseKey);

  const executionId = 12376;
  const { data: execution, error } = await supabase
    .from('workflow_executions')
    .select('id, status, workflow_id, results, execution_logs')
    .eq('id', executionId)
    .single();

  if (error) {
    console.error('❌ Failed to fetch execution:', error);
    process.exit(1);
  }

  console.log('✅ Execution found:', {
    id: execution.id,
    status: execution.status,
    workflow_id: execution.workflow_id,
    has_results: !!execution.results,
    has_logs: !!execution.execution_logs
  });

  // Test 2: Check Google credentials
  console.log('\n📌 Test 2: Check Google Vertex AI credentials');
  const hasBase64Creds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64;
  const hasJsonCreds = !!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_VERTEX_PROJECT || process.env.GOOGLE_PROJECT_ID;

  console.log('Credentials status:', {
    has_base64: hasBase64Creds,
    has_json: hasJsonCreds,
    project: project || 'NOT SET'
  });

  if (!hasBase64Creds && !hasJsonCreds) {
    console.error('❌ No Google credentials found!');
    console.log('\n💡 You need to set either:');
    console.log('   - GOOGLE_APPLICATION_CREDENTIALS_BASE64');
    console.log('   - GOOGLE_APPLICATION_CREDENTIALS_JSON');
    process.exit(1);
  }

  if (!project) {
    console.error('❌ No Google Cloud project configured!');
    console.log('\n💡 You need to set one of:');
    console.log('   - GOOGLE_CLOUD_PROJECT');
    console.log('   - GOOGLE_VERTEX_PROJECT');
    console.log('   - GOOGLE_PROJECT_ID');
    process.exit(1);
  }

  console.log('✅ Google credentials configured');

  // Test 3: Test the API endpoint directly
  console.log('\n📌 Test 3: Call /api/ai/execution-qa endpoint');

  const apiUrl = 'http://localhost:3000/api/ai/execution-qa';

  console.log('Calling:', apiUrl);
  console.log('Payload:', JSON.stringify({
    executionId,
    messages: [{ role: 'user', content: 'Were there any errors?' }]
  }, null, 2));

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        executionId,
        messages: [{ role: 'user', content: 'Were there any errors in this execution?' }]
      })
    });

    console.log('\nResponse status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API error:', errorText);
      process.exit(1);
    }

    // Check content type
    const contentType = response.headers.get('content-type');
    console.log('Content-Type:', contentType);

    if (!contentType || !contentType.includes('text/plain')) {
      console.error('❌ Expected text/plain stream, got:', contentType);
      const body = await response.text();
      console.log('Response body:', body.substring(0, 500));
      process.exit(1);
    }

    // Read stream
    console.log('\n📊 Reading stream...\n');

    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;
    let totalChars = 0;
    let hasContent = false;

    for await (const chunk of response.body) {
      chunkCount++;
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      totalChars += text.length;

      // Check if we have actual content
      if (text.includes('data:')) {
        hasContent = true;
      }

      console.log(`Chunk ${chunkCount}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
    }

    console.log(`\n✅ Stream complete: ${chunkCount} chunks, ${totalChars} characters`);

    if (!hasContent) {
      console.error('❌ WARNING: Stream had no "data:" lines!');
      console.log('Full buffer:', buffer);
      process.exit(1);
    }

    // Parse the buffer to see what we got
    const lines = buffer.split('\n');
    let textContent = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data && data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text-delta' && parsed.textDelta) {
              textContent += parsed.textDelta;
            }
            console.log('Parsed chunk:', { type: parsed.type, hasTextDelta: !!parsed.textDelta });
          } catch (e) {
            console.warn('Failed to parse:', data.substring(0, 50));
          }
        }
      }
    }

    if (textContent) {
      console.log('\n✅ SUCCESS! Received text:', textContent.substring(0, 200));
    } else {
      console.error('❌ No text content received!');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }

  console.log('\n🎉 All tests passed!');
}

testQAEndpoint().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
