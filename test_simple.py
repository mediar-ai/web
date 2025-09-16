import asyncio
import json
import httpx
from datetime import datetime

MCP_ENDPOINT = "http://13.77.110.245:8080/mcp"

async def test_workflow():
    print("=" * 60)
    print("TESTING WORKFLOW EXECUTION")
    print("=" * 60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        # Test direct execute_sequence call
        request = {
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
            "id": 1
        }

        print(f"[SEND] Sending request to {MCP_ENDPOINT}")
        print(f"[PAYLOAD] {json.dumps(request, indent=2)}")

        try:
            start = datetime.now()
            response = await client.post(MCP_ENDPOINT, json=request)
            elapsed = (datetime.now() - start).total_seconds()

            print(f"[OK] Response received after {elapsed:.2f} seconds")
            print(f"[STATUS] {response.status_code}")
            result = response.json()
            print(f"[RESULT] {json.dumps(result, indent=2)[:1000]}")

        except httpx.TimeoutException:
            elapsed = (datetime.now() - start).total_seconds()
            print(f"[TIMEOUT] Request timed out after {elapsed:.2f} seconds")
            print("[PROBLEM] This is where workflows hang!")

        except Exception as e:
            print(f"[ERROR] {e}")

if __name__ == "__main__":
    asyncio.run(test_workflow())