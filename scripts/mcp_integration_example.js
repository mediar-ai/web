#!/usr/bin/env node

/**
 * MCP Integration Example
 * 
 * Demonstrates how to integrate MCP SDK into applications
 * Shows practical patterns for workflow automation
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

class WorkflowAutomationClient {
  constructor(mcpServerUrl = 'https://app.mediar.ai/api/mcp') {
    this.serverUrl = mcpServerUrl;
    this.client = null;
    this.transport = null;
    this.isConnected = false;
  }

  /**
   * Initialize connection to MCP server
   */
  async connect() {
    if (this.isConnected) return;

    this.transport = new StreamableHTTPClientTransport(this.serverUrl);
    this.client = new Client(
      { name: "workflow-automation-client", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    await this.client.connect(this.transport);
    this.isConnected = true;
  }

  /**
   * Get available automation tools
   */
  async getAvailableWorkflows() {
    await this.connect();
    const result = await this.client.listTools();
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: Object.keys(tool.inputSchema?.properties || {}),
      parameterCount: Object.keys(tool.inputSchema?.properties || {}).length
    }));
  }

  /**
   * Set up insurance products for quoting
   */
  async setupInsuranceProducts(options = {}) {
    await this.connect();
    
    const result = await this.client.callTool({
      name: 'insurance_set_available_products',
      arguments: {
        execution_mode: options.sync ? 'sync' : 'async',
        include_cache: options.useCache !== false,
        full_detailed_response: options.detailed || false,
        ...options
      }
    });

    return this.parseExecutionResult(result);
  }

  /**
   * Generate insurance quote
   */
  async generateInsuranceQuote(applicantInfo) {
    await this.connect();

    // Validate required fields
    const required = ['applicant_dob', 'applicant_height', 'applicant_weight', 
                     'applicant_gender', 'applicant_state', 'applicant_zip_code'];
    
    for (const field of required) {
      if (!applicantInfo[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    const result = await this.client.callTool({
      name: 'insurance_best_plan_pro_insurance_quote',
      arguments: {
        execution_mode: 'async',
        include_cache: true,
        // Default values
        quote_type: 'Face Value',
        quote_value: '50000',
        applicant_tobacco_usage: 'Never',
        open_enrollment_status: 'Yes',
        policy_coverage_type: 'Best Case: Graded Coverage',
        product_types: ['FEX', 'MedSup', 'Preneed', 'Term'],
        ...applicantInfo
      }
    });

    return this.parseExecutionResult(result);
  }

  /**
   * Parse execution result from MCP response
   */
  parseExecutionResult(mcpResult) {
    try {
      if (mcpResult.content && mcpResult.content[0] && mcpResult.content[0].text) {
        const data = JSON.parse(mcpResult.content[0].text);
        return {
          success: data.type === 'success',
          executionId: data.execution_id,
          workflowId: data.workflow_id,
          workflowName: data.data?.workflow_name,
          status: data.status,
          message: data.message,
          modalCallId: data.data?.modal_call_id,
          createdAt: data.data?.created_at,
          endpoints: data.data?.endpoints,
          validation: data.data?.validation,
          rawResponse: data
        };
      }
    } catch (error) {
      console.warn('Failed to parse execution result:', error.message);
    }

    return {
      success: false,
      message: 'Failed to parse execution result',
      rawResponse: mcpResult
    };
  }

  /**
   * Disconnect from MCP server
   */
  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.close();
      this.isConnected = false;
    }
  }
}

// Example usage functions
async function exampleUsage() {
  console.log('🚀 MCP Integration Example');
  console.log('==========================\n');

  const automation = new WorkflowAutomationClient();

  try {
    // 1. Discover available workflows
    console.log('1. Discovering available workflows...');
    const workflows = await automation.getAvailableWorkflows();
    workflows.forEach((workflow, index) => {
      console.log(`   ${index + 1}. ${workflow.name}`);
      console.log(`      ${workflow.description.substring(0, 80)}...`);
      console.log(`      Parameters: ${workflow.parameterCount}`);
    });

    // 2. Set up insurance products
    console.log('\n2. Setting up insurance products...');
    const setupResult = await automation.setupInsuranceProducts({
      useCache: true,
      detailed: false
    });
    
    if (setupResult.success) {
      console.log(`   ✅ Setup queued: Execution ${setupResult.executionId}`);
      console.log(`   📋 Workflow: ${setupResult.workflowName}`);
      console.log(`   ⏰ Status: ${setupResult.status}`);
    } else {
      console.log(`   ❌ Setup failed: ${setupResult.message}`);
    }

    // 3. Generate insurance quote
    console.log('\n3. Generating insurance quote...');
    const quoteResult = await automation.generateInsuranceQuote({
      applicant_dob: '01/15/1985',
      applicant_height: '6 0',
      applicant_weight: '180',
      applicant_gender: 'Male',
      applicant_state: 'California',
      applicant_zip_code: '90210',
      quote_type: 'Face Value',
      quote_value: '100000'
    });

    if (quoteResult.success) {
      console.log(`   ✅ Quote queued: Execution ${quoteResult.executionId}`);
      console.log(`   📋 Workflow: ${quoteResult.workflowName}`);
      console.log(`   ⏰ Status: ${quoteResult.status}`);
      console.log(`   🔗 Monitor: ${quoteResult.endpoints?.status}`);
    } else {
      console.log(`   ❌ Quote failed: ${quoteResult.message}`);
    }

    console.log('\n✅ Integration example completed successfully!');
    console.log('💡 Use the execution IDs above to monitor workflow progress.');

  } catch (error) {
    console.error('❌ Integration example failed:', error.message);
  } finally {
    await automation.disconnect();
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
MCP Integration Example

Usage:
  node mcp_integration_example.js [options]

Options:
  --local, -l     Use local development server
  --help, -h      Show this help message

Examples:
  node mcp_integration_example.js          # Use production server
  node mcp_integration_example.js --local  # Use local server
`);
    return;
  }

  // Use local server if requested
  if (args.includes('--local') || args.includes('-l')) {
    // Override default for local testing
    global.mcpServerUrl = 'http://localhost:3000/api/mcp';
  }

  await exampleUsage();
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Example crashed:', error);
    process.exit(1);
  });
}

export { WorkflowAutomationClient }; 