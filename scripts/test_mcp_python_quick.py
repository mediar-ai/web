#!/usr/bin/env python3
"""
Quick MCP Server Health Check (Python SDK)

Fast validation script for CI/CD pipelines and rapid health checks.
"""

import asyncio
import json
import sys
import time
from contextlib import asynccontextmanager

try:
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
except ImportError as e:
    print(f"❌ Missing required dependencies: {e}")
    print("Please install: pip install mcp httpx")
    sys.exit(1)


class Colors:
    """ANSI color codes for terminal output."""
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    PURPLE = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    END = '\033[0m'


@asynccontextmanager
async def create_mcp_client(server_url: str):
    """Create an async context manager for MCP client."""
    async with streamablehttp_client(server_url) as (read_stream, write_stream, _):
        async with ClientSession(read_stream, write_stream) as session:
            yield session


async def quick_health_check(server_url: str) -> dict:
    """Perform a quick health check of the MCP server."""
    
    start_time = time.time()
    result = {
        "server_url": server_url,
        "timestamp": time.time(),
        "status": "unknown",
        "response_time_ms": 0,
        "tools_count": 0,
        "error": None
    }
    
    try:
        print(f"{Colors.BLUE}🔍 Testing MCP server: {server_url}{Colors.END}")
        
        async with create_mcp_client(server_url) as session:
            # Test connection and tool discovery
            tools = await session.list_tools()
            
            result["status"] = "healthy"
            result["tools_count"] = len(tools.tools)
            result["response_time_ms"] = round((time.time() - start_time) * 1000, 1)
            
            print(f"{Colors.GREEN}✅ Server HEALTHY{Colors.END}")
            print(f"{Colors.CYAN}📊 Tools available: {len(tools.tools)}{Colors.END}")
            print(f"{Colors.CYAN}⚡ Response time: {result['response_time_ms']}ms{Colors.END}")
            
            return result
            
    except Exception as e:
        result["status"] = "unhealthy"
        result["error"] = str(e)
        result["response_time_ms"] = round((time.time() - start_time) * 1000, 1)
        
        print(f"{Colors.RED}❌ Server UNHEALTHY: {str(e)}{Colors.END}")
        return result


async def main():
    """Main function to run the quick health check."""
    
    # Determine server URL from arguments
    if len(sys.argv) > 1 and sys.argv[1] == "--local":
        server_url = "http://localhost:3000/api/mcp"
    else:
        server_url = "https://app.mediar.ai/api/mcp"
    
    print(f"{Colors.BOLD}{Colors.PURPLE}🏥 MCP Quick Health Check (Python SDK){Colors.END}")
    print(f"{Colors.PURPLE}{'=' * 50}{Colors.END}")
    
    # Run health check
    result = await quick_health_check(server_url)
    
    # Output JSON result for CI/CD
    print(f"\n{Colors.YELLOW}📋 JSON Result:{Colors.END}")
    print(json.dumps(result, indent=2))
    
    # Exit with appropriate code
    exit_code = 0 if result["status"] == "healthy" else 1
    
    if exit_code == 0:
        print(f"\n{Colors.GREEN}{Colors.BOLD}🎉 Health check PASSED{Colors.END}")
    else:
        print(f"\n{Colors.RED}{Colors.BOLD}💀 Health check FAILED{Colors.END}")
    
    sys.exit(exit_code)


if __name__ == "__main__":
    asyncio.run(main()) 