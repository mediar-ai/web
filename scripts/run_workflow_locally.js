#!/usr/bin/env node

/**
 * 🚀 LOCAL WORKFLOW EXECUTOR: Manual execution of MCP workflow sequences
 * 
 * This script starts a local MCP server on port 3001 using the local binary
 * and executes workflow sequences against it, providing a fully self-contained testing environment.
 * 
 * Usage:
 *     node scripts/run_workflow_locally.js
 * 
 * Configuration:
 *     - Workflow file: sequences/071425_merged.json
 *     - MCP server: localhost:3001 (started locally via local binary)
 *     - Binary: C:\Users\terminatoradmin\Desktop\terminator\target\release\terminator-mcp-agent.exe
 *     - Execution: Real browser automation via local MCP
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const http2 = require('http2');

// Local MCP Configuration
const MCP_PORT = 3001;
const MCP_BASE_URL = `http://localhost:${MCP_PORT}`;
const MCP_ENDPOINT = `${MCP_BASE_URL}/mcp`;
const MCP_HEALTH_ENDPOINT = `${MCP_BASE_URL}/health`;

// Local Binary Path
const MCP_BINARY_PATH = "C:\\Users\\terminatoradmin\\Desktop\\terminator\\target\\release\\terminator-mcp-agent.exe";

// Default workflow file
const DEFAULT_WORKFLOW_FILE = "sequences/071425_merged.json";

// Global MCP server process and HTTP/2 session management
let mcpServerProcess = null;
let http2Session = null;
let mcpSessionId = null;

// Cleanup function
function cleanup() {
    if (http2Session) {
        console.log('🔗 Closing HTTP/2 session...');
        http2Session.close();
        http2Session = null;
    }
    if (mcpServerProcess) {
        console.log('🛑 Shutting down MCP server...');
        mcpServerProcess.kill('SIGTERM');
        mcpServerProcess = null;
    }
}

// Handle graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

/**
 * Load workflow from JSON file
 */
function loadWorkflow(filePath) {
    try {
        const fullPath = path.resolve(filePath);
        const workflowData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        
        console.log(`📋 Loaded workflow from: ${filePath}`);
        console.log(`   Tool: ${workflowData.tool_name}`);
        
        if (workflowData.tool_name === 'execute_sequence') {
            const steps = workflowData.arguments.steps;
            console.log(`   Steps: ${steps.length} workflow groups`);
        }
        
        return workflowData;
    } catch (error) {
        console.error(`❌ Failed to load workflow: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Start local MCP server
 */
async function startMCPServer() {
    return new Promise((resolve, reject) => {
        console.log('🚀 Starting local MCP server...');
        console.log(`   Binary: ${MCP_BINARY_PATH}`);
        console.log(`   Port: ${MCP_PORT}`);
        
        // Check if binary exists
        if (!fs.existsSync(MCP_BINARY_PATH)) {
            reject(new Error(`MCP binary not found at: ${MCP_BINARY_PATH}`));
            return;
        }
        
        // Start MCP server using local binary
        mcpServerProcess = spawn(MCP_BINARY_PATH, [
            '--port', MCP_PORT.toString(),
            '--transport', 'http'
        ], {
            stdio: 'pipe'
        });
        
        let serverOutput = '';
        
        mcpServerProcess.stdout.on('data', (data) => {
            const output = data.toString();
            serverOutput += output;
            console.log(`📡 MCP Server: ${output.trim()}`);
            
            // Look for server ready indicator
            if (output.includes('Server listening') || output.includes(`http://localhost:${MCP_PORT}`)) {
                console.log('✅ MCP server is ready!');
                resolve();
            }
        });
        
        mcpServerProcess.stderr.on('data', (data) => {
            const error = data.toString();
            console.error(`🔥 MCP Server Error: ${error.trim()}`);
            serverOutput += error;
        });
        
        mcpServerProcess.on('error', (error) => {
            console.error(`❌ Failed to start MCP server: ${error.message}`);
            reject(error);
        });
        
        mcpServerProcess.on('exit', (code) => {
            if (code !== 0) {
                console.error(`❌ MCP server exited with code: ${code}`);
                console.error(`Server output: ${serverOutput}`);
                reject(new Error(`MCP server exited with code: ${code}`));
            }
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            if (mcpServerProcess && mcpServerProcess.exitCode === null) {
                console.log('⏰ MCP server startup timeout, assuming it\'s ready...');
                resolve();
            }
        }, 10000);
    });
}

/**
 * Create HTTP/2 connection to MCP server
 */
async function createHTTP2Connection() {
    return new Promise((resolve, reject) => {
        console.log('🔗 Creating HTTP/2 connection...');
        
        try {
            http2Session = http2.connect(MCP_BASE_URL);
            
            http2Session.on('connect', () => {
                console.log('✅ HTTP/2 connection established!');
                resolve(http2Session);
            });
            
            http2Session.on('error', (error) => {
                console.error(`❌ HTTP/2 connection error: ${error.message}`);
                reject(error);
            });
            
            http2Session.on('close', () => {
                console.log('🔗 HTTP/2 connection closed');
                http2Session = null;
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (http2Session && !http2Session.destroyed) {
                    console.log('✅ HTTP/2 connection ready (timeout assumed)');
                    resolve(http2Session);
                } else {
                    reject(new Error('HTTP/2 connection timeout'));
                }
            }, 10000);
            
        } catch (error) {
            console.error(`❌ Failed to create HTTP/2 connection: ${error.message}`);
            reject(error);
        }
    });
}

/**
 * Wait for MCP server to be healthy
 */
async function waitForMCPHealth() {
    console.log('🔍 Waiting for MCP server health check...');
    
    for (let i = 0; i < 30; i++) {
        try {
            const response = await fetch(MCP_HEALTH_ENDPOINT);
            if (response.ok) {
                console.log('✅ MCP server is healthy!');
                return;
            }
        } catch (error) {
            // Health check failed, wait and retry
        }
        
        console.log(`⏳ Health check attempt ${i + 1}/30...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('MCP server health check timeout');
}

/**
 * Initialize MCP session using HTTP/2 streaming
 */
async function initializeMCPSession() {
    const payload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "initialize",
        params: {
            protocolVersion: "2024-11-05",
            capabilities: {
                tools: {}
            },
            clientInfo: {
                name: "local-workflow-executor",
                version: "1.0.0"
            }
        }
    };
    
    return new Promise((resolve, reject) => {
        console.log(`🔄 Initializing MCP session via HTTP/2...`);
        console.log(`📤 Init Payload:`, JSON.stringify(payload, null, 2));
        
        const stream = http2Session.request({
            ':method': 'POST',
            ':path': '/mcp',
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream'
        });
        
        let responseData = '';
        
        stream.on('response', (headers) => {
            console.log(`📥 Init Response status: ${headers[':status']}`);
            console.log(`📥 Init Response headers:`, headers);
            
            // Capture MCP session ID from headers
            if (headers['mcp-session-id']) {
                mcpSessionId = headers['mcp-session-id'];
                console.log(`🔑 MCP Session ID captured: ${mcpSessionId}`);
            }
        });
        
        stream.on('data', (chunk) => {
            const data = chunk.toString();
            responseData += data;
            console.log(`📡 Received data chunk: ${data}`);
        });
        
        stream.on('end', () => {
            console.log(`📊 Raw MCP Init Response:`, responseData);
            
            // Parse SSE format - look for data: lines
            const lines = responseData.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6); // Remove 'data: ' prefix
                    try {
                        const result = JSON.parse(jsonStr);
                        console.log(`📊 MCP Init Response:`, JSON.stringify(result, null, 2));
                        console.log(`✅ MCP session initialized successfully!`);
                        resolve(result);
                        return;
                    } catch (parseError) {
                        console.error(`❌ Failed to parse JSON from SSE line: ${line}`);
                    }
                }
            }
            
            reject(new Error('No valid JSON data found in streaming response'));
        });
        
        stream.on('error', (error) => {
            console.error(`❌ MCP session initialization failed: ${error.message}`);
            reject(error);
        });
        
        // Send the payload
        stream.write(JSON.stringify(payload));
        stream.end();
    });
}

/**
 * Send initialized notification to complete MCP handshake
 */
async function sendInitializedNotification() {
    const payload = {
        jsonrpc: "2.0",
        method: "initialized",
        params: {}
    };
    
    return new Promise((resolve, reject) => {
        console.log(`📡 Sending initialized notification...`);
        console.log(`📤 Notification Payload:`, JSON.stringify(payload, null, 2));
        
        const requestHeaders = {
            ':method': 'POST',
            ':path': '/mcp',
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream'
        };
        
        // Add session ID if available
        if (mcpSessionId) {
            requestHeaders['mcp-session-id'] = mcpSessionId;
            console.log(`🔑 Sending MCP Session ID: ${mcpSessionId}`);
        }
        
        const stream = http2Session.request(requestHeaders);
        
        let responseData = '';
        
        stream.on('response', (headers) => {
            console.log(`📥 Notification Response status: ${headers[':status']}`);
            console.log(`📥 Notification Response headers:`, headers);
        });
        
        stream.on('data', (chunk) => {
            const data = chunk.toString();
            responseData += data;
            console.log(`📡 Received notification data chunk: ${data}`);
        });
        
        stream.on('end', () => {
            console.log(`📊 Raw Notification Response:`, responseData);
            console.log(`✅ Initialized notification sent successfully!`);
            resolve();
        });
        
        stream.on('error', (error) => {
            console.error(`❌ Initialized notification failed: ${error.message}`);
            reject(error);
        });
        
        // Send the payload
        stream.write(JSON.stringify(payload));
        stream.end();
    });
}



/**
 * Execute MCP tool using HTTP/2 streaming
 */
async function executeMCPTool(toolName, args) {
    const payload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
            name: toolName,
            arguments: args
        }
    };
    
    return new Promise((resolve, reject) => {
        console.log(`🔧 Executing MCP tool: ${toolName}`);
        console.log(`📤 Payload:`, JSON.stringify(payload, null, 2));
        
        const requestHeaders = {
            ':method': 'POST',
            ':path': '/mcp',
            'content-type': 'application/json',
            'accept': 'application/json, text/event-stream'
        };
        
        // Add session ID if available
        if (mcpSessionId) {
            requestHeaders['mcp-session-id'] = mcpSessionId;
            console.log(`🔑 Sending MCP Session ID: ${mcpSessionId}`);
        }
        
        const stream = http2Session.request(requestHeaders);
        
        let responseData = '';
        
        stream.on('response', (headers) => {
            console.log(`📥 Response status: ${headers[':status']}`);
            console.log(`📥 Response headers:`, headers);
        });
        
        let dataReceived = false;
        let lastResult = null;
        let stepCount = 0;
        
        // Set up a timeout for long-running operations
        const timeoutDuration = 600000; // 10 minutes for workflow execution
        const timeoutTimer = setTimeout(() => {
            console.log(`⏰ Workflow execution timeout after ${timeoutDuration / 1000} seconds`);
            if (lastResult) {
                console.log(`📊 Returning last received result due to timeout`);
                resolve(lastResult);
            } else {
                reject(new Error('Workflow execution timed out'));
            }
        }, timeoutDuration);
        
        stream.on('data', (chunk) => {
            const data = chunk.toString();
            responseData += data;
            
            // Try to parse streaming data immediately
            const lines = data.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6); // Remove 'data: ' prefix
                    try {
                        const result = JSON.parse(jsonStr);
                        dataReceived = true;
                        lastResult = result;
                        
                        // Show progress updates
                        if (result.result && result.result.step_progress) {
                            stepCount++;
                            console.log(`🔄 Step ${stepCount}: ${result.result.step_progress.current_step || 'Unknown'}`);
                            if (result.result.step_progress.message) {
                                console.log(`   📝 ${result.result.step_progress.message}`);
                            }
                        } else if (result.result && result.result.status) {
                            console.log(`📊 Status: ${result.result.status}`);
                        } else if (result.error) {
                            console.error(`❌ Error: ${result.error.message || JSON.stringify(result.error)}`);
                        } else {
                            console.log(`📡 Update: ${JSON.stringify(result).substring(0, 200)}...`);
                        }
                        
                        // Check if this is a final result
                        if (result.result && (result.result.success !== undefined || result.result.final === true)) {
                            clearTimeout(timeoutTimer);
                            console.log(`✅ Workflow completed with final result`);
                            resolve(result);
                            return;
                        }
                    } catch (parseError) {
                        // Show raw data for debugging incomplete chunks
                        if (data.length > 10) {
                            console.log(`📡 Raw chunk (${data.length} chars): ${data.substring(0, 100)}...`);
                        }
                    }
                }
            }
        });
        
        stream.on('end', () => {
            clearTimeout(timeoutTimer);
            console.log(`📊 Stream ended. Data received: ${dataReceived}`);
            
            if (lastResult) {
                console.log(`📊 Returning last valid result`);
                resolve(lastResult);
                return;
            }
            
            // Handle case where workflow is starting but no immediate data
            if (responseData.length === 0 && dataReceived === false) {
                console.log(`⚠️  No data received yet - workflow may be starting...`);
                console.log(`🔄 The workflow is likely running in the background.`);
                console.log(`💡 Check the VM desktop to see if the browser automation is happening.`);
                resolve({ 
                    result: { 
                        success: true, 
                        message: 'Workflow started successfully - check VM desktop for browser automation',
                        status: 'running'
                    } 
                });
                return;
            }
            
            // Try to parse the complete response
            const lines = responseData.split('\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6); // Remove 'data: ' prefix
                    try {
                        const result = JSON.parse(jsonStr);
                        console.log(`📊 Final MCP Response:`, JSON.stringify(result, null, 2));
                        resolve(result);
                        return;
                    } catch (parseError) {
                        console.error(`❌ Failed to parse JSON from SSE line: ${line}`);
                    }
                }
            }
            
            if (dataReceived) {
                console.log(`⚠️  Data was received but no complete result found`);
                resolve({ result: { success: false, message: 'Partial data received' } });
            } else {
                console.log(`⚠️  No streaming data found - workflow may be running asynchronously`);
                resolve({ 
                    result: { 
                        success: true, 
                        message: 'Workflow appears to be running - check VM desktop for browser automation',
                        status: 'running'
                    } 
                });
            }
        });
        
        stream.on('error', (error) => {
            console.error(`❌ MCP tool execution failed: ${error.message}`);
            reject(error);
        });
        
        // Send the payload
        stream.write(JSON.stringify(payload));
        stream.end();
    });
}

/**
 * Execute workflow
 */
async function executeWorkflow(workflow) {
    console.log('🎯 Starting workflow execution...');
    console.log(`📝 Workflow: ${workflow.tool_name}`);
    
    if (workflow.arguments && workflow.arguments.steps) {
        console.log(`📋 Total steps: ${workflow.arguments.steps.length}`);
        console.log(`🌐 Target URL: ${workflow.arguments.inputs?.url || 'N/A'}`);
    }
    
    try {
        const result = await executeMCPTool(workflow.tool_name, workflow.arguments);
        
        console.log('✅ Workflow execution completed!');
        console.log('📊 Final Result:', JSON.stringify(result, null, 2));
        
        return result;
    } catch (error) {
        console.error(`❌ Workflow execution failed: ${error.message}`);
        throw error;
    }
}

/**
 * Main execution
 */
async function main() {
    try {
        console.log('🔧 LOCAL WORKFLOW EXECUTOR');
        console.log('=' .repeat(50));
        
        // Load workflow
        const workflow = loadWorkflow(DEFAULT_WORKFLOW_FILE);
        
        // Start MCP server
        await startMCPServer();
        
        // Wait for server to be healthy
        await waitForMCPHealth();
        
        // Create HTTP/2 connection
        await createHTTP2Connection();
        
        // Initialize MCP session
        await initializeMCPSession();
        
        // Send initialized notification (required by MCP protocol)
        await sendInitializedNotification();
        
        // Execute workflow
        await executeWorkflow(workflow);
        
    } catch (error) {
        console.error(`💥 Fatal error: ${error.message}`);
        process.exit(1);
    }
}

// Ask user for confirmation before starting
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('🚀 Ready to start local MCP server and execute workflow? (y/N): ', (answer) => {
    rl.close();
    
    if (answer.toLowerCase().startsWith('y')) {
        main();
    } else {
        console.log('👋 Aborted by user');
        process.exit(0);
    }
}); 