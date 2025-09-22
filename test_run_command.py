#!/usr/bin/env python3
import asyncio
import json
import httpx
from datetime import datetime

MCP_ENDPOINT = "http://172.171.201.185:8080/mcp"

async def test_run_command():
    print("=" * 60)
    print("TESTING MCP RUN_COMMAND")
    print("=" * 60)

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
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
                    "name": "test-run",
                    "version": "1.0.0"
                }
            }
        }

        response = await client.post(MCP_ENDPOINT, json=init_request, headers=headers)
        session_id = response.headers.get('mcp-session-id')
        print(f"   Session ID: {session_id}")

        # Step 1.5: Send initialized notification
        print("\n1.5. Sending initialized notification...")
        headers_with_session = {**headers, "Mcp-Session-Id": session_id}
        initialized_request = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }
        await client.post(MCP_ENDPOINT, json=initialized_request, headers=headers_with_session)

        # Step 2: Test run_command with simple JavaScript
        print("\n2. Testing run_command with JavaScript...")
        run_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "run_command",
                "arguments": {
                    "engine": "javascript",
                    "run": "console.log('Hello from MCP'); return {result: 'success', timestamp: new Date().toISOString()};"
                }
            }
        }

        print("   Sending run_command...")
        start = datetime.now()

        try:
            response = await client.post(
                MCP_ENDPOINT,
                json=run_request,
                headers=headers_with_session,
                timeout=30.0
            )

            elapsed = (datetime.now() - start).total_seconds()
            print(f"   Response in {elapsed:.2f}s - Status: {response.status_code}")

            if response.status_code == 200:
                content = response.text
                for line in content.split('\n'):
                    if line.startswith('data: '):
                        try:
                            data = json.loads(line[6:])
                            if 'result' in data:
                                print(f"   SUCCESS! Result: {json.dumps(data['result'], indent=2)[:500]}")
                            elif 'error' in data:
                                print(f"   ERROR: {data['error']}")
                        except:
                            pass
            else:
                print(f"   Error: {response.text[:500]}")

        except httpx.TimeoutException:
            elapsed = (datetime.now() - start).total_seconds()
            print(f"   TIMEOUT after {elapsed:.2f}s - run_command is hanging")

if __name__ == "__main__":
    asyncio.run(test_run_command())