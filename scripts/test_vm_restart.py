#!/usr/bin/env python3
"""
Test script to demonstrate VM restart functionality in Modal workflow executor.

This script shows how the Modal workflow executor will handle MCP server failures
by automatically restarting the Windows VM service via ngrok.
"""

import json
import asyncio
import httpx
from datetime import datetime


# Configuration matching the Modal app
VM_MANAGEMENT_ENDPOINT = "https://vm-windows-1.ngrok.dev"
MCP_ENDPOINT = "https://mcp-server-1.ngrok.app/mcp"


async def check_mcp_server_health():
    """Test MCP server health check (same as in Modal app)"""
    try:
        print("🏥 Checking MCP server health...")
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Extract base URL from MCP endpoint - properly handle the path
            if MCP_ENDPOINT.endswith('/mcp'):
                mcp_base_url = MCP_ENDPOINT[:-4]  # Remove last 4 characters (/mcp)
            else:
                mcp_base_url = MCP_ENDPOINT.rsplit('/', 1)[0]  # Remove last path segment
            health_url = f"{mcp_base_url}/health"
            

            
            response = await client.get(
                health_url,
                headers={"ngrok-skip-browser-warning": "true"}
            )
            
            if response.status_code == 200:
                print("✅ MCP server is healthy")
                return True
            else:
                print(f"⚠️ MCP server returned status {response.status_code}")
                return False
                
    except Exception as e:
        print(f"❌ MCP server health check failed: {e}")
        return False


async def restart_windows_vm_service():
    """Test Windows VM service restart (same as in Modal app)"""
    try:
        print("🔄 Attempting to restart Windows VM service...")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{VM_MANAGEMENT_ENDPOINT}/restart",
                headers={"ngrok-skip-browser-warning": "true"}
            )
            
            if response.status_code == 200:
                result = response.json()
                if result.get("success", False):
                    print("✅ Windows VM service restarted successfully")
                    print(f"📋 Service status: {result.get('service_status', {}).get('status', 'Unknown')}")
                    return True
                else:
                    print(f"❌ VM service restart failed: {result.get('error', 'Unknown error')}")
                    return False
            else:
                print(f"❌ VM management endpoint returned status {response.status_code}")
                return False
                
    except Exception as e:
        print(f"❌ Failed to restart Windows VM service: {e}")
        return False


async def wait_for_mcp_server_recovery(max_wait_seconds=60):
    """Test MCP server recovery wait (same as in Modal app)"""
    print("⏳ Waiting for MCP server to come back online...")
    
    start_time = asyncio.get_event_loop().time()
    retry_count = 0
    
    while (asyncio.get_event_loop().time() - start_time) < max_wait_seconds:
        retry_count += 1
        print(f"🔍 Health check attempt {retry_count}...")
        
        if await check_mcp_server_health():
            recovery_time = int(asyncio.get_event_loop().time() - start_time)
            print(f"✅ MCP server is back online after {recovery_time} seconds")
            return True
        
        # Wait 5 seconds before next check
        await asyncio.sleep(5)
    
    print(f"❌ MCP server did not come back online within {max_wait_seconds} seconds")
    return False


async def simulate_mcp_failure_scenario():
    """Simulate the full MCP failure and recovery scenario"""
    print("🧪 Simulating MCP server failure scenario...")
    print("="*60)
    
    # Step 1: Check current MCP server health
    print("\n📋 Step 1: Initial health check")
    initial_health = await check_mcp_server_health()
    
    if not initial_health:
        print("🚨 MCP server is already down! Proceeding with recovery...")
        
        # Step 2: Attempt VM service restart
        print("\n📋 Step 2: Attempting Windows VM service restart")
        restart_success = await restart_windows_vm_service()
        
        if restart_success:
            # Step 3: Wait for recovery
            print("\n📋 Step 3: Waiting for MCP server recovery")
            recovery_success = await wait_for_mcp_server_recovery(max_wait_seconds=90)
            
            if recovery_success:
                print("\n🎉 Recovery scenario completed successfully!")
                print("✅ The Modal app would now retry the workflow execution.")
                return True
            else:
                print("\n❌ Recovery scenario failed - server did not come back online")
                return False
        else:
            print("\n❌ Recovery scenario failed - could not restart VM service")
            return False
    else:
        print("✅ MCP server is currently healthy")
        print("💡 To test the failure scenario, temporarily stop the MCP server")
        return True


async def test_all_endpoints():
    """Test all endpoints to verify system status"""
    print("🔍 Testing all system endpoints...")
    print("="*60)
    
    results = {
        "timestamp": datetime.utcnow().isoformat(),
        "tests": {}
    }
    
    # Test 1: VM Management endpoint
    print("\n📋 Test 1: VM Management endpoint health")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{VM_MANAGEMENT_ENDPOINT}/health",
                headers={"ngrok-skip-browser-warning": "true"}
            )
            
            if response.status_code == 200:
                data = response.json()
                print(f"✅ VM Management endpoint healthy: {data.get('status', 'unknown')}")
                results["tests"]["vm_management"] = {"status": "healthy", "data": data}
            else:
                print(f"❌ VM Management endpoint unhealthy: {response.status_code}")
                results["tests"]["vm_management"] = {"status": "unhealthy", "status_code": response.status_code}
    except Exception as e:
        print(f"❌ VM Management endpoint error: {e}")
        results["tests"]["vm_management"] = {"status": "error", "error": str(e)}
    
    # Test 2: MCP server health
    print("\n📋 Test 2: MCP server health")
    mcp_healthy = await check_mcp_server_health()
    results["tests"]["mcp_server"] = {"status": "healthy" if mcp_healthy else "unhealthy"}
    
    # Test 3: MCP endpoint direct test
    print("\n📋 Test 3: MCP endpoint direct test")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Try to initialize MCP session (like the Modal app does)
            init_request = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"roots": {"listChanged": False}, "sampling": {}},
                    "clientInfo": {"name": "test-client", "version": "1.0.0"},
                },
            }
            
            response = await client.post(
                MCP_ENDPOINT,
                json=init_request,
                headers={"Accept": "application/json, text/event-stream"},
            )
            
            if response.status_code == 200:
                print("✅ MCP session initialization successful")
                results["tests"]["mcp_endpoint"] = {"status": "healthy", "status_code": 200}
            else:
                print(f"❌ MCP session initialization failed: {response.status_code}")
                results["tests"]["mcp_endpoint"] = {"status": "unhealthy", "status_code": response.status_code}
    except Exception as e:
        print(f"❌ MCP endpoint error: {e}")
        results["tests"]["mcp_endpoint"] = {"status": "error", "error": str(e)}
    
    return results


async def main():
    """Main test function"""
    print("🚀 VM Restart Functionality Test")
    print("="*60)
    print(f"🔗 MCP Endpoint: {MCP_ENDPOINT}")
    print(f"🔄 VM Management: {VM_MANAGEMENT_ENDPOINT}")
    print(f"⏰ Test Time: {datetime.utcnow().isoformat()}")
    
    # Test all endpoints first
    endpoint_results = await test_all_endpoints()
    
    print("\n" + "="*60)
    print("📊 Test Results Summary:")
    for test_name, test_result in endpoint_results["tests"].items():
        status_icon = "✅" if test_result["status"] == "healthy" else "❌"
        print(f"  {status_icon} {test_name}: {test_result['status']}")
    
    # If MCP server is unhealthy, demonstrate recovery
    if endpoint_results["tests"]["mcp_server"]["status"] != "healthy":
        print("\n" + "="*60)
        await simulate_mcp_failure_scenario()
    
    print("\n🎯 This demonstrates how the Modal workflow executor will:")
    print("  • Detect MCP server failures automatically")
    print("  • Restart the Windows VM service via ngrok")
    print("  • Wait for service recovery")
    print("  • Retry workflow execution after recovery")
    print("  • Provide detailed error context if recovery fails")


if __name__ == "__main__":
    asyncio.run(main()) 