#!/usr/bin/env node

/**
 * Test script for NSSM Remote Service Management API
 * Usage: node scripts/test_nssm_api.js [action]
 * Actions: status, start, stop, restart, health
 */

const BASE_URL = process.env.VERCEL_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/admin/manage-nssm-service`;

async function testNSSMAPI(action = 'status') {
  console.log(`🚀 Testing NSSM API - Action: ${action}`);
  console.log(`📡 Endpoint: ${API_ENDPOINT}`);
  console.log('---');

  try {
    let response;
    
    if (action === 'check') {
      // Use GET endpoint for status check
      console.log('📋 Checking service status (GET request)...');
      response = await fetch(API_ENDPOINT);
    } else {
      // Use POST endpoint for service actions
      console.log(`🔧 Executing service action: ${action}`);
      response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          action,
          force: false // Set to true to bypass connectivity checks
        }),
      });
    }

    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log(`✅ Success: ${data.success}`);
    console.log(`🖥️  VM Status: ${data.vm_status}`);
    
    if (data.service_status) {
      console.log(`🔧 Service Status:`, data.service_status);
    }
    
    if (data.health_status) {
      console.log(`💚 Health Status:`, data.health_status);
    }
    
    if (data.error) {
      console.log(`❌ Error: ${data.error}`);
      if (data.details) {
        console.log(`📝 Details: ${data.details}`);
      }
    }
    
    if (data.raw_output) {
      console.log(`📄 Raw Output:`, data.raw_output);
    }
    
    console.log(`⏰ Timestamp: ${data.timestamp}`);
    console.log('---');
    
    return data;

  } catch (error) {
    console.error('❌ Failed to test NSSM API:', error.message);
    throw error;
  }
}

// Test multiple operations in sequence
async function runFullTest() {
  console.log('🎯 Starting comprehensive NSSM API test...\n');
  
  const operations = ['check', 'status', 'health'];
  
  for (const operation of operations) {
    try {
      await testNSSMAPI(operation);
      console.log(`✅ ${operation} test completed\n`);
      
      // Wait a bit between operations
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`❌ ${operation} test failed:`, error.message);
      console.log(''); // Add spacing
    }
  }
  
  console.log('🏁 Full test sequence completed');
}

// Main execution
async function main() {
  const action = process.argv[2] || 'check';
  
  console.log('🔧 NSSM Remote Service Management API Test');
  console.log('==========================================\n');
  
  if (action === 'full') {
    await runFullTest();
  } else {
    await testNSSMAPI(action);
  }
}

// Export for use in other scripts
module.exports = { testNSSMAPI, runFullTest };

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Test script failed:', error);
    process.exit(1);
  });
} 