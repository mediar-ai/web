/**
 * Test script for server-side tool execution
 * Run with: node test-server-tools.mjs
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.local') });

const API_URL = process.env.MEDIAR_API_URL || 'https://app.mediar.ai';
const API_PASSWORD = process.env.AI_API_PASSWORD || process.env.DEV_AUTH_TOKEN;

if (!API_PASSWORD) {
  console.error('❌ No API password found in environment');
  process.exit(1);
}

console.log('🚀 Testing server-side tool execution');
console.log('📍 API URL:', API_URL);
console.log('🔑 Using auth token:', API_PASSWORD.substring(0, 10) + '...');

async function testKnowledgeSearch() {
  console.log('\n📚 Test 1: Knowledge Search Tool');
  console.log('================================');

  const request = {
    model: 'gemini-2.5-flash',
    input: 'Find a workflow step that submits a form or clicks a submit button',
    system: 'You are a helpful assistant that searches the knowledge base for relevant workflow steps. Use the search_similar_workflow_steps tool to find examples.',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1000
    }
  };

  console.log('📤 Sending request...');
  console.log('   Input:', request.input);

  try {
    const response = await fetch(`${API_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_PASSWORD}`
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ API Error:', response.status, error);
      return;
    }

    const result = await response.json();

    console.log('\n📥 Response received:');
    console.log('   Session ID:', result.sessionId);
    console.log('   Model:', result.model);
    console.log('   Text length:', result.text?.length || 0);
    console.log('   Tool calls:', result.toolCalls?.length || 0);
    console.log('   Finish reason:', result.finishReason);

    if (result.metrics) {
      console.log('   Elapsed:', result.metrics.elapsedMs, 'ms');
      if (result.metrics.tokens) {
        console.log('   Tokens:', result.metrics.tokens.totalTokenCount);
      }
    }

    if (result.text) {
      console.log('\n💬 AI Response:');
      console.log('---');
      console.log(result.text);
      console.log('---');
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log('\n🔧 Client tools requested:');
      result.toolCalls.forEach(tc => {
        console.log(`   - ${tc.name}:`, JSON.stringify(tc.args, null, 2));
      });
    }

    // Check server logs to see if knowledge tool was executed
    console.log('\n✅ Test completed!');
    console.log('Check server logs for:');
    console.log('  - "🔧 Executing server-side tool: search_similar_workflow_steps"');
    console.log('  - "✅ Server tool search_similar_workflow_steps executed successfully"');
    console.log('  - "🔄 Auto-continuing with 1 server tool results"');

    return result.sessionId;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function testWithoutTools(sessionId) {
  console.log('\n🎯 Test 2: Regular Chat (No Tools)');
  console.log('===================================');

  const request = {
    model: 'gemini-2.5-flash',
    sessionId: sessionId || undefined,
    input: 'What did you find in the previous search?',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1000
    }
  };

  console.log('📤 Sending follow-up request...');
  console.log('   Session ID:', sessionId || 'new');
  console.log('   Input:', request.input);

  try {
    const response = await fetch(`${API_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_PASSWORD}`
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ API Error:', response.status, error);
      return;
    }

    const result = await response.json();

    console.log('\n📥 Response received:');
    console.log('   Text length:', result.text?.length || 0);
    console.log('   Tool calls:', result.toolCalls?.length || 0);

    if (result.text) {
      console.log('\n💬 AI Response:');
      console.log('---');
      console.log(result.text.substring(0, 500) + (result.text.length > 500 ? '...' : ''));
      console.log('---');
    }

    console.log('\n✅ Test completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run tests
async function main() {
  const sessionId = await testKnowledgeSearch();

  if (sessionId) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await testWithoutTools(sessionId);
  }

  console.log('\n🎉 All tests completed!');
}

main().catch(console.error);