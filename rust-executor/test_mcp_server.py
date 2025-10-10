#!/usr/bin/env python3
"""
Simple Mock MCP Server for testing the Rust Workflow Executor
This simulates an MCP server that responds to workflow tool calls
"""

from flask import Flask, request, jsonify
import json
import time
from datetime import datetime
import uuid

app = Flask(__name__)

# Store execution history
executions = []

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "server": "mock-mcp-server",
        "version": "1.0.0"
    })

@app.route('/', methods=['POST'])
@app.route('/rpc', methods=['POST'])
def rpc():
    """Handle JSON-RPC requests from the MCP client"""
    data = request.json
    print(f"[MCP] Received RPC request: {json.dumps(data, indent=2)}")

    method = data.get('method')
    params = data.get('params', {})
    request_id = data.get('id')

    # Handle different MCP methods
    if method == 'initialize':
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocol_version": "1.0.0",
                "capabilities": {
                    "tools": True
                },
                "server_info": {
                    "name": "mock-mcp-server",
                    "version": "1.0.0"
                }
            }
        }

    elif method == 'list_tools' or method == 'tools/list':
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "tools": [
                    {
                        "name": "browser_navigate",
                        "description": "Navigate to a URL",
                        "input_schema": {
                            "type": "object",
                            "properties": {
                                "url": {"type": "string"}
                            }
                        }
                    },
                    {
                        "name": "browser_screenshot",
                        "description": "Take a screenshot",
                        "input_schema": {
                            "type": "object",
                            "properties": {
                                "filename": {"type": "string"}
                            }
                        }
                    },
                    {
                        "name": "browser_close",
                        "description": "Close the browser",
                        "input_schema": {
                            "type": "object"
                        }
                    }
                ]
            }
        }

    elif method == 'call_tool' or method == 'tools/call':
        tool_name = params.get('name')
        arguments = params.get('arguments', {})

        print(f"[MCP] Executing tool: {tool_name} with args: {arguments}")

        # Simulate tool execution
        time.sleep(0.5)  # Simulate processing time

        result = {
            "success": True,
            "tool": tool_name,
            "timestamp": datetime.now().isoformat()
        }

        if tool_name == 'browser_navigate':
            result['message'] = f"Navigated to {arguments.get('url', 'unknown')}"
        elif tool_name == 'browser_screenshot':
            result['message'] = f"Screenshot saved as {arguments.get('filename', 'screenshot.png')}"
            result['path'] = f"/tmp/{arguments.get('filename', 'screenshot.png')}"
        elif tool_name == 'browser_close':
            result['message'] = "Browser closed successfully"
        else:
            result['message'] = f"Tool {tool_name} executed"

        # Track execution
        executions.append({
            "id": str(uuid.uuid4()),
            "tool": tool_name,
            "arguments": arguments,
            "result": result,
            "timestamp": datetime.now().isoformat()
        })

        response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(result)
                    }
                ]
            }
        }

    else:
        # Unknown method
        response = {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32601,
                "message": f"Method not found: {method}"
            }
        }

    print(f"[MCP] Sending response: {json.dumps(response, indent=2)[:200]}...")
    return jsonify(response)

@app.route('/executions', methods=['GET'])
def get_executions():
    """Get execution history (for debugging)"""
    return jsonify({
        "executions": executions,
        "total": len(executions)
    })

if __name__ == '__main__':
    print("=" * 60)
    print("Mock MCP Server for Testing")
    print("=" * 60)
    print("Server starting on http://localhost:3000")
    print("Endpoints:")
    print("  - POST /rpc         : JSON-RPC endpoint for MCP")
    print("  - GET  /health      : Health check")
    print("  - GET  /executions  : View execution history")
    print("=" * 60)
    print("\nWaiting for MCP client connections...")
    print("")

    app.run(host='0.0.0.0', port=3000, debug=True)