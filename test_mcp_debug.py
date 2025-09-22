#!/usr/bin/env python3
import requests
import json

MCP_ENDPOINT = "http://172.171.201.185:8080/mcp"
HEALTH_ENDPOINT = "http://172.171.201.185:8080/health"

def test_mcp_connection():
    print("=" * 60)
    print("TESTING MCP CONNECTION")
    print("=" * 60)

    # First check health
    print("\n1. Checking health endpoint...")
    try:
        response = requests.get(HEALTH_ENDPOINT, timeout=5)
        print(f"   Health Status: {response.status_code}")
        if response.status_code == 200:
            print(f"   Health Data: {json.dumps(response.json(), indent=2)}")
    except Exception as e:
        print(f"   Health Check Failed: {e}")

    # Test MCP with proper JSONRPC format
    print("\n2. Testing MCP initialize...")

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
    }

    init_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"roots": {"listChanged": False}, "sampling": {}},
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        }
    }

    try:
        response = requests.post(MCP_ENDPOINT, json=init_request, headers=headers, timeout=10)
        print(f"   MCP Initialize Status: {response.status_code}")
        print(f"   Response Headers: {dict(response.headers)}")

        if response.status_code == 200:
            # MCP returns SSE format, get session from headers
            session_id = response.headers.get('mcp-session-id')
            print(f"   MCP Initialize Success!")
            print(f"   Session ID: {session_id}")

            # Parse SSE response
            content = response.text
            print(f"   Response (first 200 chars): {content[:200]}")

            return session_id
        else:
            print(f"   MCP Error: {response.text[:500]}")

    except Exception as e:
        print(f"   MCP Connection Failed: {e}")

    return None

def test_tools_list(session_id):
    print("\n3. Testing tools/list...")

    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
    }

    if session_id:
        headers["X-Session-ID"] = session_id

    list_request = {
        "jsonrpc": "2.0",
        "method": "tools/list",
        "params": {},
        "id": 2
    }

    try:
        response = requests.post(MCP_ENDPOINT, json=list_request, headers=headers, timeout=10)
        print(f"   Tools List Status: {response.status_code}")

        if response.status_code == 200:
            result = response.json()
            tools = result.get('result', {}).get('tools', [])
            print(f"   Available Tools: {len(tools)}")
            for tool in tools[:5]:  # Show first 5
                print(f"     - {tool.get('name')}")
        else:
            print(f"   Tools List Error: {response.text[:500]}")

    except Exception as e:
        print(f"   Tools List Failed: {e}")

if __name__ == "__main__":
    session_id = test_mcp_connection()
    if session_id:
        test_tools_list(session_id)
    else:
        print("\nFailed to initialize MCP session")