import asyncio
import json
import httpx
from datetime import datetime

MCP_ENDPOINT = "http://13.77.110.245:8080/mcp"

async def test_with_session():
    print("=" * 60)
    print("TESTING WITH PROPER SESSION")
    print("=" * 60)

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1: Initialize session
        print("\n[STEP 1] Initialize MCP session")
        init_request = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0.0"
                },
                "capabilities": {}
            },
            "id": 1
        }

        response = await client.post(MCP_ENDPOINT, json=init_request)
        print(f"[INIT] Status: {response.status_code}")

        if response.status_code != 200:
            print(f"[ERROR] Failed to initialize: {response.text}")
            return

        result = response.json()
        session_id = result.get("result", {}).get("sessionId")
        print(f"[SESSION] ID: {session_id}")

        # Step 2: Send initialized notification
        print("\n[STEP 2] Send initialized notification")
        notif_request = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }

        headers = {"X-Session-ID": session_id}
        response = await client.post(MCP_ENDPOINT, json=notif_request, headers=headers)
        print(f"[NOTIF] Status: {response.status_code}")

        # Step 3: Execute sequence
        print("\n[STEP 3] Execute workflow sequence")
        seq_request = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": "execute_sequence",
                "arguments": {
                    "steps": [
                        {
                            "tool_name": "navigate_browser",
                            "arguments": {"url": "https://www.google.com"}
                        },
                        {
                            "tool_name": "wait_for_element",
                            "arguments": {
                                "selector": "role:Search",
                                "condition": "exists",
                                "timeout_ms": 5000
                            }
                        }
                    ]
                }
            },
            "id": 2
        }

        print("[SEND] Sending execute_sequence...")
        print(f"[TIMEOUT] Using 30 second timeout...")

        try:
            start = datetime.now()
            response = await client.post(MCP_ENDPOINT, json=seq_request, headers=headers)
            elapsed = (datetime.now() - start).total_seconds()

            print(f"[OK] Response after {elapsed:.2f} seconds")
            print(f"[STATUS] {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                print(f"[SUCCESS] Workflow completed!")
                # Print first 500 chars of result
                result_str = json.dumps(result, indent=2)
                print(f"[RESULT] {result_str[:500]}...")
            else:
                print(f"[ERROR] Response: {response.text[:500]}")

        except httpx.TimeoutException:
            elapsed = (datetime.now() - start).total_seconds()
            print(f"\n[TIMEOUT] Request hung for {elapsed:.2f} seconds")
            print("[CRITICAL] wait_for_element is hanging!")
            print("[PROBLEM] The selector 'role:Search' might not exist on Google")

if __name__ == "__main__":
    asyncio.run(test_with_session())