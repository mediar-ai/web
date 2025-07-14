#!/usr/bin/env node

/**
 * Comprehensive Test Script for Programmatic NSSM Service Restart
 * 
 * This script demonstrates how to programmatically restart the NSSM service
 * on your Windows VM from your backend code.
 * 
 * Usage: node scripts/test_programmatic_restart.js
 */

const BASE_URL = process.env.VERCEL_URL || 'http://localhost:3000';
const API_ENDPOINT = `${BASE_URL}/api/admin/manage-nssm-service`;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(action, method = 'POST') {
  try {
    log(`\n🔧 Testing ${action.toUpperCase()} action...`, 'cyan');
    
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (method === 'POST') {
      options.body = JSON.stringify({ action });
    }
    
    const response = await fetch(API_ENDPOINT, options);
    const data = await response.json();
    
    log(`📊 Status: ${response.status}`, response.status < 400 ? 'green' : 'red');
    log(`✅ Success: ${data.success}`, data.success ? 'green' : 'yellow');
    log(`🖥️  VM Status: ${data.vm_status}`, data.vm_status === 'reachable' ? 'green' : 'red');
    
    if (data.service_status) {
      log(`🔧 Service Status: ${JSON.stringify(data.service_status, null, 2)}`, 'blue');
    }
    
    if (data.error) {
      log(`❌ Error: ${data.error}`, 'red');
    }
    
    if (data.raw_output) {
      log(`📄 Raw Output: ${data.raw_output}`, 'magenta');
    }
    
    log(`⏰ Timestamp: ${data.timestamp}`, 'yellow');
    
    return data;
    
  } catch (error) {
    log(`💥 Test failed: ${error.message}`, 'red');
    throw error;
  }
}

async function demonstrateBackendIntegration() {
  log('\n🔗 Backend Integration Example:', 'bright');
  log('================================', 'bright');
  
  const exampleCode = `
// Example: Integrate into your backend
async function restartVMService() {
  try {
    const response = await fetch('/api/admin/manage-nssm-service', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restart' })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Service restarted successfully!');
      return result;
    } else {
      console.log('❌ Service restart failed:', result.error);
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('💥 Failed to restart service:', error);
    throw error;
  }
}

// Usage in your application
app.post('/admin/emergency-restart', async (req, res) => {
  try {
    const result = await restartVMService();
    res.json({ success: true, message: 'Service restarted', data: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
`;
  
  log(exampleCode, 'green');
}

async function checkDeploymentStatus() {
  log('\n🏥 Deployment Status Check:', 'bright');
  log('============================', 'bright');
  
  try {
    // Test ngrok management server endpoint
    const managementResponse = await fetch('https://vm-windows-1.ngrok.dev/health', {
      method: 'GET',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (managementResponse.ok) {
      const managementData = await managementResponse.json();
      log('✅ Management server is running via ngrok!', 'green');
      log(`📋 Management server info: ${JSON.stringify(managementData, null, 2)}`, 'blue');
      
      // Also check MCP server
      try {
        const mcpResponse = await fetch('https://mcp-server-1.ngrok.app/health', {
          method: 'GET',
          headers: { 'ngrok-skip-browser-warning': 'true' },
          signal: AbortSignal.timeout(5000)
        });
        
        if (mcpResponse.ok) {
          const mcpData = await mcpResponse.json();
          log('✅ MCP server is also running via ngrok!', 'green');
          log(`📋 MCP server info: ${JSON.stringify(mcpData, null, 2)}`, 'blue');
        }
             } catch {
         log('⚠️ MCP server not accessible via ngrok', 'yellow');
       }
      
      return true;
    } else {
      log('❌ Management server not accessible via ngrok', 'red');
      return false;
    }
  } catch (error) {
    log('❌ Ngrok tunnels not available', 'yellow');
    log(`   Error: ${error.message}`, 'yellow');
    return false;
  }
}

async function runComprehensiveTest() {
  log('🚀 Comprehensive NSSM Service Management Test', 'bright');
  log('==============================================', 'bright');
  
  // Check deployment status
  const isDeployed = await checkDeploymentStatus();
  
  if (!isDeployed) {
    log('\n📋 Deployment Status:', 'yellow');
    log('Ngrok tunnels are not accessible. Check if the Windows VM system is running:', 'yellow');
    log('1. RDP to 48.214.144.108:3389', 'yellow');
    log('2. Ensure PowerShell HTTP server is running on port 8080', 'yellow');
    log('3. Ensure ngrok tunnels are active:', 'yellow');
    log('   - Management: https://vm-windows-1.ngrok.dev', 'yellow');
    log('   - MCP Server: https://mcp-server-1.ngrok.app', 'yellow');
    log('\nSee windows-remote-service/windows_service_management_guide.md for system details.', 'yellow');
  }
  
  // Test all endpoints
  const tests = [
    { action: 'check', method: 'GET' },
    { action: 'status', method: 'POST' },
    { action: 'health', method: 'POST' },
    { action: 'restart', method: 'POST' }
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const result = await testEndpoint(test.action, test.method);
      results.push({ ...test, success: result.success, result });
      
      // Wait between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      results.push({ ...test, success: false, error: error.message });
    }
  }
  
  // Summary
  log('\n📊 Test Results Summary:', 'bright');
  log('========================', 'bright');
  
  results.forEach(({ action, method, success, error }) => {
    const status = success ? '✅ PASS' : '❌ FAIL';
    const color = success ? 'green' : 'red';
    log(`${status} ${method} ${action}${error ? ` - ${error}` : ''}`, color);
  });
  
  const passCount = results.filter(r => r.success).length;
  const totalCount = results.length;
  
  log(`\n🎯 Overall: ${passCount}/${totalCount} tests passed`, passCount === totalCount ? 'green' : 'yellow');
  
  // Show next steps
  log('\n🎉 Next Steps:', 'bright');
  if (isDeployed) {
    log('✅ Your service restart is fully automated via ngrok!', 'green');
    log('✅ You can now restart the VM service programmatically from anywhere.', 'green');
    log('🌐 External access available via HTTPS tunnels.', 'green');
  } else {
    log('📋 Start the Windows VM system to enable full automation.', 'yellow');
    log('🔧 For now, you can use RDP for manual service restart.', 'yellow');
  }
  
  return results;
}

// Backend integration example
demonstrateBackendIntegration();

// Run the comprehensive test
runComprehensiveTest().catch(error => {
  log(`💥 Test script failed: ${error.message}`, 'red');
  process.exit(1);
});

// Export for use in other modules
module.exports = { testEndpoint, checkDeploymentStatus, runComprehensiveTest }; 