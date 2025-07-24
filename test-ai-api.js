#!/usr/bin/env node

/**
 * Simple test script for the AI API
 * Run with: node test-ai-api.js
 */

const API_BASE = process.env.AI_API_BASE || 'http://localhost:3000/api/ai';
const API_PASSWORD = process.env.AI_API_PASSWORD || 'your-secret-password-here';

async function testHealthCheck() {
  console.log('🏥 Testing health check...');
  
  try {
    const response = await fetch(API_BASE, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_PASSWORD}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Health check passed');
    console.log('📋 Available models:', data.availableModels);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function testTextGeneration() {
  console.log('\n💭 Testing text generation...');
  
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_PASSWORD}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Say hello and explain what you are in one sentence.',
        model: 'gemini-1.5-flash',
        maxTokens: 100,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Text generation passed');
    console.log('🤖 Response:', data.text);
    console.log('📊 Usage:', data.usage);
    return true;
  } catch (error) {
    console.error('❌ Text generation failed:', error.message);
    return false;
  }
}

async function testStreaming() {
  console.log('\n🌊 Testing streaming response...');
  
  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_PASSWORD}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Count from 1 to 5 slowly, with a word between each number.',
        model: 'gemini-1.5-flash',
        stream: true,
        maxTokens: 50,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    console.log('✅ Streaming started');
    console.log('📡 Stream output:');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          if (data === '[DONE]') {
            console.log('\n✅ Streaming completed');
            return true;
          }

          try {
            const parsed = JSON.parse(data);
            process.stdout.write(parsed.text);
            fullText += parsed.text;
          } catch (e) {
            // Skip invalid JSON lines
          }
        }
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Streaming failed:', error.message);
    return false;
  }
}

async function testAuthentication() {
  console.log('\n🔐 Testing authentication...');
  
  try {
    // Test without auth
    const response = await fetch(API_BASE, {
      method: 'GET',
    });

    if (response.status === 401) {
      console.log('✅ Authentication properly blocks unauthorized requests');
      return true;
    } else {
      console.error('❌ Authentication should have failed but didn\'t');
      return false;
    }
  } catch (error) {
    console.error('❌ Authentication test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting AI API tests...\n');
  console.log(`📍 API Base URL: ${API_BASE}`);
  console.log(`🔑 Using password: ${API_PASSWORD.slice(0, 3)}***\n`);

  const results = [];
  
  results.push(await testAuthentication());
  results.push(await testHealthCheck());
  results.push(await testTextGeneration());
  results.push(await testStreaming());

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`\n📊 Test Results: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('🎉 All tests passed! Your AI API is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.');
    console.log('\n💡 Common issues:');
    console.log('  - Make sure your Next.js server is running (npm run dev)');
    console.log('  - Check your Google Cloud credentials are set up');
    console.log('  - Verify the AI_API_PASSWORD environment variable');
    console.log('  - Ensure the Google Vertex AI API is enabled');
  }

  process.exit(passed === total ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('💥 Test runner crashed:', error);
  process.exit(1);
});