#!/usr/bin/env python3
"""
Test script to run workflow executor locally with the MCP endpoint
"""
import asyncio
import json
import os
import sys
from pathlib import Path

# Fix Windows console encoding for emojis
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8')

# Add modal_apps to path
sys.path.insert(0, str(Path(__file__).parent))

from modal_apps.workflow_executor import execute_workflow


async def test_workflow():
    """Test workflow execution with the problematic endpoint"""
    
    # Test parameters matching your error context
    test_params = {
        "workflow_id": 1,
        "execution_id": "test-local-execution-001",
        "execution_params": {
            # Add any required parameters for your workflow here
            "test_param": "test_value"
        },
        "mcp_endpoint": "http://172.203.20.145:8080/mcp",  # The problematic endpoint
        "machine_id": 1,
        "client_id": "test-client",
        "user_id": "test-user",
        "version_number": None,  # Use active version
    }
    
    print(f"🧪 Testing workflow executor with endpoint: {test_params['mcp_endpoint']}")
    print(f"📋 Workflow ID: {test_params['workflow_id']}")
    print("-" * 50)
    
    try:
        # Run the workflow executor
        result = await execute_workflow(
            workflow_id=test_params["workflow_id"],
            execution_id=test_params["execution_id"],
            execution_params=test_params["execution_params"],
            mcp_endpoint=test_params["mcp_endpoint"],
            machine_id=test_params["machine_id"],
            client_id=test_params["client_id"],
            user_id=test_params["user_id"],
            version_number=test_params["version_number"],
        )
        
        print("\n✅ Workflow executed successfully!")
        print(f"📊 Result: {json.dumps(result, indent=2)}")
        
    except Exception as e:
        print(f"\n❌ Error executing workflow: {e}")
        import traceback
        traceback.print_exc()


async def test_mcp_connection():
    """Test direct MCP connection to verify endpoint is working"""
    import httpx
    
    endpoints_to_test = [
        "http://172.203.20.145:8080/mcp",  # Original endpoint
        "http://172.203.20.145:8080/health",  # Health check
        "https://vm-windows-1.ngrok.dev/mcp",  # VM management endpoint with MCP
    ]
    
    print("🔍 Testing MCP endpoints directly...")
    print("-" * 50)
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        for endpoint in endpoints_to_test:
            try:
                print(f"\n📡 Testing: {endpoint}")
                
                # Try health endpoint first
                if not endpoint.endswith('/health'):
                    health_url = endpoint.replace('/mcp', '/health')
                    try:
                        health_resp = await client.get(health_url)
                        print(f"  Health check: {health_resp.status_code}")
                        if health_resp.status_code == 200:
                            print(f"  Health response: {health_resp.text[:200]}")
                    except Exception as e:
                        print(f"  Health check failed: {e}")
                
                # Try MCP initialize
                if endpoint.endswith('/mcp'):
                    init_request = {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {"roots": {"listChanged": False}, "sampling": {}},
                            "clientInfo": {
                                "name": "test-client",
                                "version": "1.0.0",
                            },
                        },
                    }
                    
                    try:
                        resp = await client.post(
                            endpoint,
                            json=init_request,
                            headers={"Accept": "application/json, text/event-stream"}
                        )
                        print(f"  MCP initialize: {resp.status_code}")
                        if resp.status_code == 200:
                            print(f"  MCP response: {resp.text[:200]}")
                        else:
                            print(f"  MCP error: {resp.text[:500]}")
                    except Exception as e:
                        print(f"  MCP initialize failed: {e}")
                        
            except Exception as e:
                print(f"  ❌ Connection failed: {e}")


if __name__ == "__main__":
    print("=" * 60)
    print("🚀 Workflow Executor Local Test")
    print("=" * 60)
    
    # First test MCP endpoints
    asyncio.run(test_mcp_connection())
    
    print("\n" + "=" * 60)
    print("🧪 Now testing workflow execution...")
    print("=" * 60)
    
    # Uncomment to test actual workflow execution
    # Note: This requires database access and proper environment setup
    # asyncio.run(test_workflow())
    
    print("\n✨ Test complete!")