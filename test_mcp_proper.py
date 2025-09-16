import asyncio
import json
import httpx
from datetime import datetime

MCP_ENDPOINT = "http://13.77.110.245:8080/mcp"

async def test_proper_mcp():
    print("=" * 60)
    print("TESTING MCP WITH CORRECT HEADERS")
    print("=" * 60)

    # MCP requires these headers
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json"
    }

    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        # Step 1: Initialize
        print("\n[STEP 1] Initialize MCP session")
        init_request = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "workflow-executor",
                    "version": "1.0.0"
                },
                "capabilities": {}
            },
            "id": 1
        }

        response = await client.post(MCP_ENDPOINT, json=init_request)
        print(f"[INIT] Status: {response.status_code}")

        if response.status_code != 200:
            print(f"[ERROR] {response.text}")
            return

        result = response.json()
        print(f"[RESULT] {json.dumps(result, indent=2)}")
        session_id = result.get("result", {}).get("sessionId")
        print(f"[SESSION] {session_id}")

        # Step 2: Test just navigate_browser first
        print("\n[STEP 2] Test navigate_browser alone")
        nav_request = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "navigate_browser",
                "arguments": {
                    "url": "https://www.google.com"
                }
            },
            "id": 2
        }

        session_headers = {**headers, "X-Session-ID": session_id}

        print("[SEND] Sending navigate_browser...")
        start = datetime.now()

        try:
            response = await client.post(MCP_ENDPOINT, json=nav_request, headers=session_headers)
            elapsed = (datetime.now() - start).total_seconds()
            print(f"[OK] Response in {elapsed:.2f}s - Status: {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                print("[NAVIGATE] Success!")
                print(f"[DATA] {json.dumps(result, indent=2)[:300]}")
            else:
                print(f"[ERROR] {response.text[:500]}")

        except httpx.TimeoutException:
            print(f"[TIMEOUT] navigate_browser timed out")
            return

        # Step 3: Test wait_for_element
        print("\n[STEP 3] Test wait_for_element")
        wait_request = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "wait_for_element",
                "arguments": {
                    "selector": "role:textbox",  # Try a simpler selector
                    "condition": "exists",
                    "timeout_ms": 5000
                }
            },
            "id": 3
        }

        print("[SEND] Sending wait_for_element with 'role:textbox'...")
        start = datetime.now()

        try:
            response = await client.post(MCP_ENDPOINT, json=wait_request, headers=session_headers)
            elapsed = (datetime.now() - start).total_seconds()
            print(f"[OK] Response in {elapsed:.2f}s")

            if response.status_code == 200:
                print("[WAIT] Element found!")
            else:
                print(f"[ERROR] {response.text[:500]}")

        except httpx.TimeoutException:
            elapsed = (datetime.now() - start).total_seconds()
            print(f"[TIMEOUT] wait_for_element hung for {elapsed:.2f}s")
            print("[PROBLEM] wait_for_element hangs indefinitely!")

if __name__ == "__main__":
    asyncio.run(test_proper_mcp())