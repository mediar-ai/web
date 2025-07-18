#!/usr/bin/env node

/**
 * MCP SDK Test Script
 * 
 * Tests our production MCP server using the official MCP JavaScript SDK
 * Covers tool discovery, execution, error handling, and various scenarios
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Configuration
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'https://app.mediar.ai/api/mcp';
const LOCAL_SERVER_URL = 'http://localhost:3000/api/mcp';

class MCPTester {
  constructor(serverUrl = MCP_SERVER_URL) {
    this.serverUrl = serverUrl;
    this.client = null;
    this.transport = null;
  }

  /**
   * Initialize connection to MCP server
   */
  async connect() {
    console.log(`🔌 Connecting to MCP server: ${this.serverUrl}`);
    
    try {
      // Create HTTP transport
      this.transport = new StreamableHTTPClientTransport(this.serverUrl);
      
      // Create client
      this.client = new Client(
        {
          name: "mcp-test-client",
          version: "1.0.0"
        },
        {
          capabilities: {
            tools: {}
          }
        }
      );

      // Connect to server
      await this.client.connect(this.transport);
      
      console.log('✅ Successfully connected to MCP server');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to MCP server:', error.message);
      return false;
    }
  }

  /**
   * Test server initialization and capabilities
   */
  async testInitialization() {
    console.log('\n📋 Testing Server Initialization...');
    
    try {
      // The connection already handles initialization
      console.log('✅ Server initialization successful');
      
      // Get server info if available
      if (this.client.serverCapabilities) {
        console.log('📊 Server capabilities:', JSON.stringify(this.client.serverCapabilities, null, 2));
      }
      
      return true;
    } catch (error) {
      console.error('❌ Initialization test failed:', error.message);
      return false;
    }
  }

  /**
   * Test tool discovery
   */
  async testToolDiscovery() {
    console.log('\n🔍 Testing Tool Discovery...');
    
    try {
      const result = await this.client.listTools();
      
      console.log(`✅ Discovered ${result.tools.length} tools:`);
      result.tools.forEach((tool, index) => {
        console.log(`  ${index + 1}. ${tool.name}`);
        console.log(`     Description: ${tool.description}`);
        console.log(`     Parameters: ${Object.keys(tool.inputSchema?.properties || {}).length} properties`);
      });
      
      return result.tools;
    } catch (error) {
      console.error('❌ Tool discovery failed:', error.message);
      return [];
    }
  }

  /**
   * Test tool execution with different scenarios
   */
  async testToolExecution() {
    console.log('\n🚀 Testing Tool Execution...');
    
    const testScenarios = [
      {
        name: 'Set Available Products - Default Parameters',
        toolName: 'insurance_set_available_products',
        arguments: {
          execution_mode: 'async',
          include_cache: true
        }
      },
      {
        name: 'Set Available Products - Sync Mode',
        toolName: 'insurance_set_available_products',
        arguments: {
          execution_mode: 'sync',
          include_cache: false,
          full_detailed_response: true
        }
      },
      {
        name: 'Best Plan Pro Quote - Basic Parameters',
        toolName: 'insurance_best_plan_pro_insurance_quote',
        arguments: {
          execution_mode: 'async',
          include_cache: true,
          applicant_dob: '01/15/1990',
          applicant_height: '5 10',
          applicant_weight: '180',
          applicant_gender: 'Male',
          applicant_state: 'California',
          applicant_zip_code: '90210',
          quote_type: 'Face Value',
          quote_value: '50000'
        }
      },
      {
        name: 'Best Plan Pro Quote - Female Applicant',
        toolName: 'insurance_best_plan_pro_insurance_quote',
        arguments: {
          execution_mode: 'async',
          include_cache: true,
          applicant_dob: '03/22/1985',
          applicant_height: '5 6',
          applicant_weight: '140',
          applicant_gender: 'Female',
          applicant_state: 'Texas',
          applicant_zip_code: '75201',
          applicant_tobacco_usage: 'Never',
          quote_type: 'Max Monthly Budget',
          quote_value: '200'
        }
      }
    ];

    const results = [];

    for (const scenario of testScenarios) {
      console.log(`\n  📝 Testing: ${scenario.name}`);
      
      try {
        const startTime = Date.now();
        const result = await this.client.callTool({
          name: scenario.toolName,
          arguments: scenario.arguments
        });
        const duration = Date.now() - startTime;

        console.log(`  ✅ Success (${duration}ms)`);
        console.log(`  📄 Result:`, JSON.stringify(result, null, 2));
        
        results.push({
          scenario: scenario.name,
          success: true,
          duration,
          result
        });
        
      } catch (error) {
        console.error(`  ❌ Failed: ${error.message}`);
        results.push({
          scenario: scenario.name,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Test error handling scenarios
   */
  async testErrorHandling() {
    console.log('\n⚠️ Testing Error Handling...');
    
    const errorScenarios = [
      {
        name: 'Invalid Tool Name',
        toolName: 'nonexistent_tool',
        arguments: {}
      },
      {
        name: 'Missing Required Parameters',
        toolName: 'insurance_best_plan_pro_insurance_quote',
        arguments: {
          execution_mode: 'async'
          // Missing required parameters
        }
      },
      {
        name: 'Invalid Parameter Values',
        toolName: 'insurance_set_available_products',
        arguments: {
          execution_mode: 'invalid_mode',
          include_cache: 'not_a_boolean'
        }
      }
    ];

    const errorResults = [];

    for (const scenario of errorScenarios) {
      console.log(`\n  🧪 Testing: ${scenario.name}`);
      
      try {
        const result = await this.client.callTool({
          name: scenario.toolName,
          arguments: scenario.arguments
        });
        
        console.log(`  ⚠️ Unexpected success (should have failed)`);
        errorResults.push({
          scenario: scenario.name,
          expectedError: true,
          actualSuccess: true,
          result
        });
        
      } catch (error) {
        console.log(`  ✅ Correctly handled error: ${error.message}`);
        errorResults.push({
          scenario: scenario.name,
          expectedError: true,
          actualError: true,
          error: error.message
        });
      }
    }

    return errorResults;
  }

  /**
   * Test performance and concurrency
   */
  async testPerformance() {
    console.log('\n⚡ Testing Performance...');
    
    // Test sequential requests
    console.log('  📊 Testing sequential tool discovery...');
    const sequentialStart = Date.now();
    for (let i = 0; i < 3; i++) {
      await this.client.listTools();
    }
    const sequentialDuration = Date.now() - sequentialStart;
    console.log(`  ⏱️ Sequential (3 requests): ${sequentialDuration}ms`);

    // Test concurrent requests
    console.log('  📊 Testing concurrent tool discovery...');
    const concurrentStart = Date.now();
    await Promise.all([
      this.client.listTools(),
      this.client.listTools(),
      this.client.listTools()
    ]);
    const concurrentDuration = Date.now() - concurrentStart;
    console.log(`  ⏱️ Concurrent (3 requests): ${concurrentDuration}ms`);

    return {
      sequential: sequentialDuration,
      concurrent: concurrentDuration,
      improvement: ((sequentialDuration - concurrentDuration) / sequentialDuration * 100).toFixed(1)
    };
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🧪 Starting MCP SDK Test Suite');
    console.log('=====================================');

    const testResults = {
      connection: false,
      initialization: false,
      tools: [],
      execution: [],
      errorHandling: [],
      performance: null
    };

    // Test connection
    testResults.connection = await this.connect();
    if (!testResults.connection) {
      console.log('\n❌ Cannot proceed with tests - connection failed');
      return testResults;
    }

    // Test initialization
    testResults.initialization = await this.testInitialization();

    // Test tool discovery
    testResults.tools = await this.testToolDiscovery();

    // Test tool execution
    if (testResults.tools.length > 0) {
      testResults.execution = await this.testToolExecution();
    }

    // Test error handling
    testResults.errorHandling = await this.testErrorHandling();

    // Test performance
    testResults.performance = await this.testPerformance();

    // Generate summary
    this.generateSummary(testResults);

    return testResults;
  }

  /**
   * Generate test summary
   */
  generateSummary(results) {
    console.log('\n📊 Test Summary');
    console.log('================');
    
    console.log(`🔌 Connection: ${results.connection ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`📋 Initialization: ${results.initialization ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`🔍 Tool Discovery: ${results.tools.length > 0 ? '✅ PASS' : '❌ FAIL'} (${results.tools.length} tools found)`);
    
    const successfulExecutions = results.execution.filter(r => r.success).length;
    console.log(`🚀 Tool Execution: ${successfulExecutions}/${results.execution.length} scenarios passed`);
    
    const handledErrors = results.errorHandling.filter(r => r.actualError).length;
    console.log(`⚠️ Error Handling: ${handledErrors}/${results.errorHandling.length} scenarios handled correctly`);
    
    if (results.performance) {
      console.log(`⚡ Performance: ${results.performance.improvement}% improvement with concurrency`);
    }

    console.log('\n🎯 Overall Status:', 
      results.connection && results.initialization && results.tools.length > 0 && successfulExecutions > 0 
        ? '✅ HEALTHY' 
        : '⚠️ ISSUES DETECTED'
    );
  }

  /**
   * Cleanup and disconnect
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
        console.log('👋 Disconnected from MCP server');
      } catch (error) {
        console.error('⚠️ Error during disconnect:', error.message);
      }
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const useLocal = args.includes('--local') || args.includes('-l');
  const serverUrl = useLocal ? LOCAL_SERVER_URL : MCP_SERVER_URL;

  console.log(`🎯 Testing MCP server: ${serverUrl}`);
  
  const tester = new MCPTester(serverUrl);
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('💥 Test suite crashed:', error);
  } finally {
    await tester.disconnect();
  }
}

// Handle process signals
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled rejection:', reason);
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { MCPTester }; 