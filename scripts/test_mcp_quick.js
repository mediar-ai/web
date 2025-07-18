#!/usr/bin/env node

/**
 * Quick MCP Health Check
 * 
 * Lightweight test script for rapid MCP server validation
 * Perfect for CI/CD pipelines or quick health checks
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Configuration
const DEFAULT_SERVER_URL = process.env.MCP_SERVER_URL || 'https://app.mediar.ai/api/mcp';
const TIMEOUT_MS = 10000; // 10 seconds

async function quickHealthCheck(serverUrl = DEFAULT_SERVER_URL) {
  console.log(`🔍 Quick MCP Health Check: ${serverUrl}`);
  
  const startTime = Date.now();
  let client = null;
  let transport = null;
  
  try {
    // Create transport and client
    transport = new StreamableHTTPClientTransport(serverUrl);
    client = new Client(
      { name: "mcp-health-check", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );
    
    // Connect with timeout
    const connectTimeout = setTimeout(() => {
      throw new Error('Connection timeout');
    }, TIMEOUT_MS);
    
    await client.connect(transport);
    clearTimeout(connectTimeout);
    
    // Test tool discovery
    const tools = await client.listTools();
    const connectTime = Date.now() - startTime;
    
    // Quick test results
    const status = {
      server: serverUrl,
      status: 'HEALTHY',
      connection_time_ms: connectTime,
      tools_discovered: tools.tools.length,
      tool_names: tools.tools.map(t => t.name),
      timestamp: new Date().toISOString()
    };
    
    console.log('✅ Health Check Results:');
    console.log(JSON.stringify(status, null, 2));
    
    return status;
    
  } catch (error) {
    const errorStatus = {
      server: serverUrl,
      status: 'ERROR',
      error: error.message,
      connection_time_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
    
    console.log('❌ Health Check Failed:');
    console.log(JSON.stringify(errorStatus, null, 2));
    
    return errorStatus;
    
  } finally {
    // Cleanup
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const useLocal = args.includes('--local') || args.includes('-l');
  const serverUrl = useLocal ? 'http://localhost:3000/api/mcp' : DEFAULT_SERVER_URL;
  
  const result = await quickHealthCheck(serverUrl);
  
  // Exit with appropriate code
  process.exit(result.status === 'HEALTHY' ? 0 : 1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Health check crashed:', error);
    process.exit(1);
  });
}

export { quickHealthCheck }; 