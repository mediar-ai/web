#!/usr/bin/env python3
"""Test workflow execution manually to diagnose issues"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

import asyncio
import json
import httpx
from datetime import datetime
import yaml

# MCP endpoint configuration
MCP_ENDPOINT = "http://13.77.110.245:8080/mcp"

async def test_mcp_connection():
    """Test basic MCP connection"""
    print(f"\n🔌 Testing MCP connection to {MCP_ENDPOINT}")

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Initialize session
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
            print(f"✅ MCP responded: {response.status_code}")
            result = response.json()
            print(f"📊 Response: {json.dumps(result, indent=2)}")
            return result.get("result", {}).get("sessionId")

        except Exception as e:
            print(f"❌ Connection failed: {e}")
            return None

async def test_simple_workflow(session_id):
    """Test a simple workflow execution"""
    print(f"\n🚀 Testing simple workflow with session {session_id}")

    # Simple test workflow - just navigate to Google
    workflow_request = {
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

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            print(f"📤 Sending workflow request...")
            response = await client.post(
                MCP_ENDPOINT,
                json=workflow_request,
                headers={"X-Session-ID": session_id}
            )
            print(f"✅ Response received: {response.status_code}")
            result = response.json()
            print(f"📊 Result: {json.dumps(result, indent=2)}")
            return result

        except httpx.TimeoutException:
            print(f"⏰ Request timed out after 60 seconds")
            return None
        except Exception as e:
            print(f"❌ Workflow execution failed: {e}")
            return None

async def test_wait_for_element(session_id):
    """Test wait_for_element which might be hanging"""
    print(f"\n🔍 Testing wait_for_element with session {session_id}")

    wait_request = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "wait_for_element",
            "arguments": {
                "selector": "role:Search",
                "condition": "exists",
                "timeout_ms": 5000
            }
        },
        "id": 3
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            print(f"📤 Sending wait_for_element request...")
            response = await client.post(
                MCP_ENDPOINT,
                json=wait_request,
                headers={"X-Session-ID": session_id}
            )
            print(f"✅ Response received: {response.status_code}")
            result = response.json()
            print(f"📊 Result: {json.dumps(result, indent=2)}")
            return result

        except httpx.TimeoutException:
            print(f"⏰ wait_for_element timed out - THIS IS THE PROBLEM!")
            return None
        except Exception as e:
            print(f"❌ wait_for_element failed: {e}")
            return None

async def test_full_sequence(session_id):
    """Test the full execute_sequence like the actual workflow"""
    print(f"\n🎯 Testing full execute_sequence with session {session_id}")

    sequence_request = {
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
        "id": 4
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            print(f"📤 Sending execute_sequence request...")
            start_time = datetime.now()
            response = await client.post(
                MCP_ENDPOINT,
                json=sequence_request,
                headers={"X-Session-ID": session_id}
            )
            elapsed = (datetime.now() - start_time).total_seconds()
            print(f"✅ Response received after {elapsed:.2f} seconds")
            result = response.json()
            print(f"📊 Result: {json.dumps(result, indent=2)[:500]}...")
            return result

        except httpx.TimeoutException:
            elapsed = (datetime.now() - start_time).total_seconds()
            print(f"⏰ execute_sequence timed out after {elapsed:.2f} seconds")
            print(f"🔴 THIS IS WHERE WORKFLOWS ARE HANGING!")
            return None
        except Exception as e:
            print(f"❌ execute_sequence failed: {e}")
            return None

async def main():
    """Run all tests"""
    print("=" * 60)
    print("WORKFLOW EXECUTION DIAGNOSTIC TEST")
    print("=" * 60)

    # Test MCP connection
    session_id = await test_mcp_connection()
    if not session_id:
        print("\n❌ Cannot proceed without MCP connection")
        return

    # Test individual components
    await test_simple_workflow(session_id)
    await test_wait_for_element(session_id)

    # Test full sequence
    await test_full_sequence(session_id)

    print("\n" + "=" * 60)
    print("DIAGNOSTIC TEST COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())