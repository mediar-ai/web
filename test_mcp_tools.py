#!/usr/bin/env python3
import asyncio
import json
import httpx

MCP_ENDPOINT = "http://172.171.201.185:8080/mcp"

async def test_list_tools():
    print("=" * 60)
    print("TESTING MCP TOOLS LIST")
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
                    "name": "test-tools",
                    "version": "1.0.0"
                }
            }
        }

        response = await client.post(MCP_ENDPOINT, json=init_request, headers=headers)
        print(f"   Status: {response.status_code}")

        if response.status_code != 200:
            print(f"   Error: {response.text[:500]}")
            return

        session_id = response.headers.get('mcp-session-id')
        print(f"   Session ID: {session_id}")

        # Step 1.5: Send initialized notification
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

        # Step 2: List tools
        print("\n2. Listing available tools...")
        list_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }

        response = await client.post(
            MCP_ENDPOINT,
            json=list_request,
            headers=headers_with_session,
            timeout=10.0
        )

        print(f"   Tools list status: {response.status_code}")

        if response.status_code == 200:
            # Parse SSE response
            content = response.text
            for line in content.split('\n'):
                if line.startswith('data: '):
                    try:
                        data = json.loads(line[6:])
                        if 'result' in data:
                            tools = data['result'].get('tools', [])
                            print(f"\n   Found {len(tools)} tools:")
                            for tool in tools[:20]:  # Show first 20
                                print(f"     - {tool['name']}")

                            # Check if execute_sequence exists
                            if any(t['name'] == 'execute_sequence' for t in tools):
                                print("\n   ✅ execute_sequence tool is available")
                            else:
                                print("\n   ❌ execute_sequence tool NOT found")
                                print("\n   Looking for ALL available tools:")
                                for tool in tools:
                                    print(f"     - {tool['name']}")
                    except:
                        pass
        else:
            print(f"   Error: {response.text[:500]}")

if __name__ == "__main__":
    asyncio.run(test_list_tools())