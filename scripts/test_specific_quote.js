#!/usr/bin/env node

/**
 * Test Specific Quote Parameters
 * 
 * Tests the insurance quote tool with user-provided parameters
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

async function testSpecificQuote() {
  console.log('🎯 Testing Quote Tool with Specific Parameters');
  console.log('===============================================\n');

  const serverUrl = process.argv.includes('--local') 
    ? 'http://localhost:3000/api/mcp' 
    : 'https://app.mediar.ai/api/mcp';

  console.log(`🔗 Server: ${serverUrl}`);

  let client = null;
  let transport = null;

  try {
    // Connect to MCP server
    transport = new StreamableHTTPClientTransport(serverUrl);
    client = new Client(
      { name: "quote-tester", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    console.log('🔌 Connecting...');
    await client.connect(transport);
    console.log('✅ Connected successfully\n');

    // Test parameters provided by user
    const quoteParameters = {
      applicant_dob: "01/15/1985",
      product_types: [
        "FEX",
        "MedSup", 
        "Preneed",
        "Term"
      ],
      applicant_state: "California",
      applicant_gender: "Male",
      applicant_height: "5 10",
      applicant_weight: "180",
      registration_key: "4WV-HJR-SA9",
      applicant_zip_code: "90210",
      registration_email: "louis@mediar.ai",
      policy_coverage_type: "Best Case: Graded Coverage",
      open_enrollment_status: "Yes",
      applicant_tobacco_usage: "Never",
      quote_type: "Face Value",
      quote_value: "5000",
      // Add execution control parameters
      execution_mode: "async",
      include_cache: true
    };

    console.log('📋 Quote Parameters:');
    console.log(JSON.stringify(quoteParameters, null, 2));
    console.log('\n🚀 Executing quote tool...\n');

    const startTime = Date.now();
    const result = await client.callTool({
      name: 'insurance_best_plan_pro_insurance_quote',
      arguments: quoteParameters
    });
    const duration = Date.now() - startTime;

    console.log(`⏱️  Execution time: ${duration}ms`);
    console.log('✅ Quote tool executed successfully!\n');

    // Parse and display result
    if (result.content && result.content[0] && result.content[0].text) {
      try {
        const data = JSON.parse(result.content[0].text);
        
        console.log('📊 Execution Results:');
        console.log('====================');
        console.log(`🆔 Execution ID: ${data.execution_id}`);
        console.log(`📋 Workflow: ${data.data?.workflow_name}`);
        console.log(`⏰ Status: ${data.status}`);
        console.log(`🔗 Modal Call ID: ${data.data?.modal_call_id}`);
        console.log(`📅 Created: ${data.data?.created_at}`);
        console.log(`💬 Message: ${data.message}`);

        if (data.data?.endpoints) {
          console.log('\n🔗 Monitoring Endpoints:');
          console.log(`   Status: ${serverUrl.replace('/api/mcp', '')}${data.data.endpoints.status}`);
          console.log(`   Results: ${serverUrl.replace('/api/mcp', '')}${data.data.endpoints.results}`);
        }

        if (data.data?.validation) {
          console.log('\n✅ Parameter Validation:');
          console.log(`   Parameters validated: ${data.data.validation.parameters_validated}`);
          console.log(`   Parameter count: ${data.data.validation.parameter_count}`);
          if (data.data.validation.warnings?.length > 0) {
            console.log('   ⚠️  Warnings:');
            data.data.validation.warnings.forEach(warning => {
              console.log(`     - ${warning}`);
            });
          }
        }

        console.log('\n🎯 Success! Your quote request has been queued for processing.');
        console.log('💡 Monitor the execution using the URLs above or check the deployment dashboard.');

        return {
          success: true,
          executionId: data.execution_id,
          workflowId: data.workflow_id,
          status: data.status,
          endpoints: data.data?.endpoints
        };

      } catch {
        console.log('⚠️  Could not parse structured result, showing raw response:');
        console.log(result.content[0].text);
        return { success: true, rawResult: result };
      }
    } else {
      console.log('📄 Raw Result:');
      console.log(JSON.stringify(result, null, 2));
      return { success: true, rawResult: result };
    }

  } catch (error) {
    console.error('❌ Quote test failed:', error.message);
    console.error('🔍 Error details:', error);
    return { success: false, error: error.message };
    
  } finally {
    // Cleanup
    if (client) {
      try {
        await client.close();
        console.log('\n👋 Disconnected from MCP server');
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  testSpecificQuote().catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });
}

export { testSpecificQuote }; 