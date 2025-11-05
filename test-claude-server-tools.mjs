/**
 * Test script for Claude/Anthropic with server-side tools
 * Tests the newly implemented server-side tool execution for Claude models
 * 
 * Run with: node test-claude-server-tools.mjs
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env.local') });

const API_URL = process.env.MEDIAR_API_URL || 'http://localhost:3000';
const API_PASSWORD = process.env.AI_API_PASSWORD || process.env.DEV_AUTH_TOKEN;

if (!API_PASSWORD) {
  console.error('❌ No API password found in environment');
  console.error('Set AI_API_PASSWORD or DEV_AUTH_TOKEN in .env.local');
  process.exit(1);
}

console.log('🚀 Testing Claude/Anthropic with server-side tools');
console.log('📍 API URL:', API_URL);
console.log('🔑 Using auth token:', API_PASSWORD.substring(0, 10) + '...\n');

/**
 * Test 1: Claude with Knowledge Search Tool
 */
async function testClaudeKnowledgeSearch() {
  console.log('📚 Test 1: Claude + Knowledge Search Tool');
  console.log('==========================================');

  const request = {
    model: 'claude-sonnet-4-5-20250929',  // Claude Sonnet 4.5
    input: 'Find a workflow step that submits a form or clicks a submit button',
    system: 'You are a helpful assistant that searches the knowledge base for relevant workflow steps. Use the search_similar_workflow_steps tool to find examples.',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2000
    }
  };

  console.log('📤 Sending request to Claude...');
  console.log('   Model:', request.model);
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
      console.log('\n💬 Claude Response:');
      console.log('---');
      console.log(result.text);
      console.log('---');
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log('\n🔧 Client tools requested (should be empty if server tool worked):');
      result.toolCalls.forEach(tc => {
        console.log(`   - ${tc.name}:`, JSON.stringify(tc.args, null, 2));
      });
    }

    console.log('\n✅ Test completed!');
    console.log('📊 Expected server logs:');
    console.log('  - "🛠️ Tools available: 0 client, 2 server"');
    console.log('  - "🔧 Executing server-side tool: search_similar_workflow_steps"');
    console.log('  - "✅ Server tool search_similar_workflow_steps executed successfully"');
    console.log('  - "🔄 Auto-continuing with 1 server tool results"');
    console.log('  - "🎯 Continuation result: ..."');

    return result.sessionId;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Test 2: Claude with Terminator Docs Search
 */
async function testClaudeDocSearch() {
  console.log('\n📖 Test 2: Claude + Terminator Docs Search');
  console.log('===========================================');

  const request = {
    model: 'claude-sonnet-4-5-20250929',
    input: 'How do I click an element in Terminator? Show me documentation about click_element.',
    system: 'You are a helpful assistant. Use the search_terminator_docs tool to find relevant documentation.',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2000
    }
  };

  console.log('📤 Sending request to Claude...');
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
    console.log('   Text length:', result.text?.length || 0);
    console.log('   Tool calls:', result.toolCalls?.length || 0);

    if (result.text) {
      console.log('\n💬 Claude Response:');
      console.log('---');
      console.log(result.text.substring(0, 800) + (result.text.length > 800 ? '...' : ''));
      console.log('---');
    }

    console.log('\n✅ Test completed!');
    console.log('📊 Expected server logs:');
    console.log('  - "🔧 Executing server-side tool: search_terminator_docs"');
    console.log('  - "✅ Server tool search_terminator_docs executed successfully"');

    return result.sessionId;
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Test 3: Compare with Gemini (should have same behavior)
 */
async function compareWithGemini() {
  console.log('\n⚖️  Test 3: Compare Claude vs Gemini (Same Tools)');
  console.log('==================================================');

  const testInput = 'Find a workflow that handles error dialogs or popups';
  const testSystem = 'Use the search_similar_workflow_steps tool to search for relevant examples.';

  // Test with Claude
  console.log('\n🤖 Testing Claude Sonnet 4.5...');
  const claudeRequest = {
    model: 'claude-sonnet-4-5-20250929',
    input: testInput,
    system: testSystem,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1500
    }
  };

  let claudeResult;
  try {
    const response = await fetch(`${API_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_PASSWORD}`
      },
      body: JSON.stringify(claudeRequest)
    });

    if (response.ok) {
      claudeResult = await response.json();
      console.log('   ✅ Claude response received');
      console.log('   Text length:', claudeResult.text?.length || 0);
      console.log('   Client tool calls:', claudeResult.toolCalls?.length || 0);
    } else {
      console.log('   ❌ Claude failed:', response.status);
    }
  } catch (error) {
    console.error('   ❌ Claude error:', error.message);
  }

  // Small delay
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test with Gemini
  console.log('\n🤖 Testing Gemini 2.5 Flash...');
  const geminiRequest = {
    model: 'gemini-2.5-flash',
    input: testInput,
    system: testSystem,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1500
    }
  };

  let geminiResult;
  try {
    const response = await fetch(`${API_URL}/api/ai`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_PASSWORD}`
      },
      body: JSON.stringify(geminiRequest)
    });

    if (response.ok) {
      geminiResult = await response.json();
      console.log('   ✅ Gemini response received');
      console.log('   Text length:', geminiResult.text?.length || 0);
      console.log('   Client tool calls:', geminiResult.toolCalls?.length || 0);
    } else {
      console.log('   ❌ Gemini failed:', response.status);
    }
  } catch (error) {
    console.error('   ❌ Gemini error:', error.message);
  }

  // Compare
  console.log('\n📊 Comparison:');
  console.log('   Both should execute server tools automatically');
  console.log('   Both should return text responses (not just tool calls)');
  console.log('   Client tool calls should be 0 for both (server tools executed)');

  if (claudeResult && geminiResult) {
    console.log('\n   Results:');
    console.log('   - Claude client tools:', claudeResult.toolCalls?.length || 0);
    console.log('   - Gemini client tools:', geminiResult.toolCalls?.length || 0);
    console.log('   - Claude has text:', !!claudeResult.text);
    console.log('   - Gemini has text:', !!geminiResult.text);
    
    if (claudeResult.toolCalls?.length === 0 && geminiResult.toolCalls?.length === 0) {
      console.log('\n   ✅ PASS: Both providers executed server tools automatically!');
    } else {
      console.log('\n   ⚠️  WARN: Check if server tools were executed properly');
    }
  }

  console.log('\n✅ Comparison test completed!');
}

/**
 * Test 4: Session continuity with Claude
 */
async function testClaudeSessionContinuity(sessionId) {
  if (!sessionId) {
    console.log('\n⏭️  Skipping session test (no session ID)');
    return;
  }

  console.log('\n🔄 Test 4: Claude Session Continuity');
  console.log('====================================');

  const request = {
    model: 'claude-sonnet-4-5-20250929',
    sessionId: sessionId,
    input: 'What did you find in the previous search? Summarize the key points.',
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1000
    }
  };

  console.log('📤 Sending follow-up request...');
  console.log('   Session ID:', sessionId);
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

    if (result.text) {
      console.log('\n💬 Claude Response:');
      console.log('---');
      console.log(result.text);
      console.log('---');
    }

    console.log('\n✅ Session continuity test completed!');
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run all tests
async function main() {
  console.log('⏱️  Starting test suite...\n');
  const startTime = Date.now();

  try {
    // Test 1: Knowledge search
    const sessionId = await testClaudeKnowledgeSearch();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Docs search
    await testClaudeDocSearch();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 3: Compare with Gemini
    await compareWithGemini();
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 4: Session continuity
    await testClaudeSessionContinuity(sessionId);
    
    const elapsed = Date.now() - startTime;
    console.log('\n' + '='.repeat(50));
    console.log('🎉 All tests completed!');
    console.log(`⏱️  Total time: ${(elapsed / 1000).toFixed(1)}s`);
    console.log('='.repeat(50));
  } catch (error) {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);

