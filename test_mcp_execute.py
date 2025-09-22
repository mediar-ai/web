#!/usr/bin/env python3
import asyncio
import json
import httpx
from datetime import datetime

MCP_ENDPOINT = "http://172.171.201.185:8080/mcp"

async def test_execute_sequence():
    print("=" * 60)
    print("TESTING MCP EXECUTE_SEQUENCE")
    print("=" * 60)

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Initialize
        print("\n1. Initializing MCP session...")
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"roots": {"listChanged": False}, "sampling": {}},
                "clientInfo": {
                    "name": "test-executor",
                    "version": "1.0.0"
                }
            }
        }

        response = await client.post(MCP_ENDPOINT, json=init_request, headers=headers)
        print(f"   Status: {response.status_code}")

        if response.status_code != 200:
            print(f"   Error: {response.text[:500]}")
            return

        # Get session ID from headers
        session_id = response.headers.get('mcp-session-id')
        print(f"   Session ID: {session_id}")

        # Parse SSE response
        content = response.text
        for line in content.split('\n'):
            if line.startswith('data: '):
                data = json.loads(line[6:])
                if 'result' in data:
                    print(f"   Server: {data['result']['serverInfo']['name']} v{data['result']['serverInfo']['version']}")
                    break

        # Step 1.5: Send initialized notification (required by MCP protocol)
        print("\n1.5. Sending initialized notification...")
        initialized_request = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }

        headers_with_session = {**headers, "Mcp-Session-Id": session_id}

        response = await client.post(
            MCP_ENDPOINT,
            json=initialized_request,
            headers=headers_with_session
        )
        print(f"   Initialized notification: {response.status_code}")

        # Step 2: Execute the test workflow sequence
        print("\n2. Executing test sequence...")

        # This is similar to what your workflow #20 does
        sequence_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "execute_sequence",
                "arguments": {
                    "steps": [
                        {
                            "tool_name": "run_command",
                            "arguments": {
                                "engine": "javascript",
                                "run": """
                                const os = require('os');
                                const now = new Date();
                                console.log(`Test execution at ${now.toISOString()}`);
                                console.log(`System: ${os.platform()} - ${os.hostname()}`);
                                return {
                                    set_env: {
                                        execution_time: now.toISOString(),
                                        hostname: os.hostname()
                                    }
                                };
                                """
                            }
                        }
                    ]
                }
            }
        }

        # Update headers for subsequent requests
        headers_with_session = {**headers, "Mcp-Session-Id": session_id}

        print("   Sending execute_sequence request...")
        start = datetime.now()

        try:
            response = await client.post(
                MCP_ENDPOINT,
                json=sequence_request,
                headers=headers_with_session,
                timeout=60.0
            )

            elapsed = (datetime.now() - start).total_seconds()
            print(f"   Response in {elapsed:.2f}s - Status: {response.status_code}")

            if response.status_code == 200:
                # Handle SSE response
                content = response.text
                print(f"   Response (first 500 chars): {content[:500]}")

                # Parse SSE data
                for line in content.split('\n'):
                    if line.startswith('data: '):
                        try:
                            data = json.loads(line[6:])
                            if 'result' in data:
                                print(f"\n   SUCCESS! Result: {json.dumps(data['result'], indent=2)[:500]}")
                            elif 'error' in data:
                                print(f"\n   ERROR: {data['error']}")
                        except:
                            pass
            else:
                print(f"   Error: {response.text[:500]}")

        except httpx.TimeoutException:
            elapsed = (datetime.now() - start).total_seconds()
            print(f"   TIMEOUT after {elapsed:.2f}s")
            print("   The execute_sequence appears to be hanging")

if __name__ == "__main__":
    asyncio.run(test_execute_sequence())