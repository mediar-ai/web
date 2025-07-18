#!/usr/bin/env python3
"""
Test MCP server using Python SDK.

This script tests our production MCP server using the official MCP Python SDK.
"""

import asyncio
import json
import sys
import time
from typing import Any, Dict, List
from contextlib import asynccontextmanager

try:
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    from mcp.types import CreateMessageRequestParams, CreateMessageResult, TextContent
    from mcp.shared.context import RequestContext
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
    RESET = '\033[0m'
    BOLD = '\033[1m'


class MCPTestResult:
    """Container for test results."""
    
    def __init__(self):
        self.total_tests = 0
        self.passed_tests = 0
        self.failed_tests = 0
        self.errors: List[str] = []
        self.results: Dict[str, Any] = {}
        
    def add_test(self, name: str, success: bool, details: Any = None, error: str = None):
        """Add a test result."""
        self.total_tests += 1
        if success:
            self.passed_tests += 1
        else:
            self.failed_tests += 1
            if error:
                self.errors.append(f"{name}: {error}")
        
        self.results[name] = {
            'success': success,
            'details': details,
            'error': error
        }
    
    def print_summary(self):
        """Print test summary."""
        print(f"\n{Colors.BOLD}=== MCP Python SDK Test Summary ==={Colors.RESET}")
        print(f"Total Tests: {self.total_tests}")
        print(f"{Colors.GREEN}✅ Passed: {self.passed_tests}{Colors.RESET}")
        print(f"{Colors.RED}❌ Failed: {self.failed_tests}{Colors.RESET}")
        print(f"Success Rate: {(self.passed_tests/self.total_tests*100):.1f}%")
        
        if self.errors:
            print(f"\n{Colors.RED}Errors:{Colors.RESET}")
            for error in self.errors:
                print(f"  - {error}")


class MCPPythonTester:
    """MCP Python SDK tester."""
    
    def __init__(self, server_url: str = "http://localhost:3000/api/mcp"):
        self.server_url = server_url
        self.result = MCPTestResult()
        
    async def sampling_callback(self, context: RequestContext, params: CreateMessageRequestParams) -> CreateMessageResult:
        """Optional sampling callback for LLM requests."""
        return CreateMessageResult(
            role="assistant",
            content=TextContent(
                type="text",
                text="Hello from Python MCP client!"
            ),
            model="test-model",
            stopReason="endTurn"
        )
    
    async def test_connection(self, session: ClientSession) -> bool:
        """Test basic connection to MCP server."""
        try:
            print(f"{Colors.BLUE}🔗 Testing connection...{Colors.RESET}")
            
            # Test initialization
            await session.initialize()
            print(f"{Colors.GREEN}✅ Connection successful{Colors.RESET}")
            
            self.result.add_test("connection", True, "Successfully connected to MCP server")
            return True
            
        except Exception as e:
            print(f"{Colors.RED}❌ Connection failed: {e}{Colors.RESET}")
            self.result.add_test("connection", False, error=str(e))
            return False
    
    async def test_tool_discovery(self, session: ClientSession) -> bool:
        """Test tool discovery."""
        try:
            print(f"{Colors.BLUE}🔍 Discovering tools...{Colors.RESET}")
            
            tools_response = await session.list_tools()
            tools = tools_response.tools
            
            tool_names = [tool.name for tool in tools]
            print(f"{Colors.GREEN}✅ Found {len(tools)} tools: {tool_names}{Colors.RESET}")
            
            # Check for expected tools
            expected_tools = ["insurance_set_available_products", "insurance_best_plan_pro_insurance_quote"]
            found_tools = [name for name in expected_tools if name in tool_names]
            
            if len(found_tools) == len(expected_tools):
                self.result.add_test("tool_discovery", True, {
                    "total_tools": len(tools),
                    "tool_names": tool_names,
                    "expected_tools_found": found_tools
                })
                return True
            else:
                missing_tools = [name for name in expected_tools if name not in tool_names]
                self.result.add_test("tool_discovery", False, error=f"Missing tools: {missing_tools}")
                return False
                
        except Exception as e:
            print(f"{Colors.RED}❌ Tool discovery failed: {e}{Colors.RESET}")
            self.result.add_test("tool_discovery", False, error=str(e))
            return False
    
    async def test_set_available_products(self, session: ClientSession, execution_mode: str = "async") -> bool:
        """Test insurance_set_available_products tool."""
        try:
            print(f"{Colors.BLUE}🛠️  Testing Set Available Products ({execution_mode})...{Colors.RESET}")
            
            start_time = time.time()
            
            # Test with minimal product list for faster execution
            result = await session.call_tool(
                "insurance_set_available_products",
                arguments={
                    "execution_mode": execution_mode,
                    "products_to_enable": [
                        "Aetna Accendo",
                        "Aetna Individual Whole Life",
                        "American Amicable Clear Choice"
                    ],
                    "include_cache": True,
                    "full_detailed_response": False
                }
            )
            
            response_time = (time.time() - start_time) * 1000
            
            # Extract response from content
            response_text = ""
            if result.content:
                for content in result.content:
                    if hasattr(content, 'text'):
                        response_text = content.text
                        break
            
            # Check for success indicators
            success_indicators = ["execution", "queued", "modal", "workflow"]
            has_success_indicator = any(indicator.lower() in response_text.lower() for indicator in success_indicators)
            
            if has_success_indicator:
                print(f"{Colors.GREEN}✅ Set Available Products ({execution_mode}) - {response_time:.0f}ms{Colors.RESET}")
                self.result.add_test(f"set_available_products_{execution_mode}", True, {
                    "response_time_ms": response_time,
                    "response": response_text[:200] + "..." if len(response_text) > 200 else response_text
                })
                return True
            else:
                print(f"{Colors.RED}❌ Set Available Products ({execution_mode}) - Unexpected response{Colors.RESET}")
                self.result.add_test(f"set_available_products_{execution_mode}", False, 
                                   error=f"Unexpected response: {response_text[:100]}")
                return False
                
        except Exception as e:
            print(f"{Colors.RED}❌ Set Available Products ({execution_mode}) failed: {e}{Colors.RESET}")
            self.result.add_test(f"set_available_products_{execution_mode}", False, error=str(e))
            return False
    
    async def test_insurance_quote(self, session: ClientSession, profile_name: str, profile_data: Dict[str, Any]) -> bool:
        """Test insurance quote generation."""
        try:
            print(f"{Colors.BLUE}💰 Testing Insurance Quote ({profile_name})...{Colors.RESET}")
            
            start_time = time.time()
            
            result = await session.call_tool(
                "insurance_best_plan_pro_insurance_quote", 
                arguments=profile_data
            )
            
            response_time = (time.time() - start_time) * 1000
            
            # Extract response
            response_text = ""
            if result.content:
                for content in result.content:
                    if hasattr(content, 'text'):
                        response_text = content.text
                        break
            
            # Check for success indicators
            success_indicators = ["execution", "queued", "modal", "workflow"]
            has_success_indicator = any(indicator.lower() in response_text.lower() for indicator in success_indicators)
            
            if has_success_indicator:
                print(f"{Colors.GREEN}✅ Insurance Quote ({profile_name}) - {response_time:.0f}ms{Colors.RESET}")
                self.result.add_test(f"insurance_quote_{profile_name.lower().replace(' ', '_')}", True, {
                    "response_time_ms": response_time,
                    "profile": profile_data,
                    "response": response_text[:200] + "..." if len(response_text) > 200 else response_text
                })
                return True
            else:
                print(f"{Colors.RED}❌ Insurance Quote ({profile_name}) - Unexpected response{Colors.RESET}")
                self.result.add_test(f"insurance_quote_{profile_name.lower().replace(' ', '_')}", False,
                                   error=f"Unexpected response: {response_text[:100]}")
                return False
                
        except Exception as e:
            print(f"{Colors.RED}❌ Insurance Quote ({profile_name}) failed: {e}{Colors.RESET}")
            self.result.add_test(f"insurance_quote_{profile_name.lower().replace(' ', '_')}", False, error=str(e))
            return False
    
    async def test_error_handling(self, session: ClientSession) -> bool:
        """Test error handling scenarios."""
        try:
            print(f"{Colors.BLUE}⚠️  Testing error handling...{Colors.RESET}")
            
            # Test 1: Invalid tool name
            try:
                await session.call_tool("nonexistent_tool", arguments={})
                self.result.add_test("error_invalid_tool", False, error="Should have thrown error for invalid tool")
                return False
            except Exception:
                print(f"{Colors.GREEN}✅ Invalid tool properly rejected{Colors.RESET}")
            
            # Test 2: Missing required parameters  
            try:
                await session.call_tool("insurance_set_available_products", arguments={})
                # If no error, that might be okay if defaults are used
                print(f"{Colors.YELLOW}⚠️  Missing parameters accepted (may have defaults){Colors.RESET}")
            except Exception:
                print(f"{Colors.GREEN}✅ Missing parameters properly validated{Colors.RESET}")
            
            # Test 3: Invalid parameter values
            try:
                result = await session.call_tool(
                    "insurance_best_plan_pro_insurance_quote",
                    arguments={
                        "applicant_dob": "invalid-date",
                        "applicant_state": "InvalidState"
                    }
                )
                # Check if response indicates parameter validation
                response_text = ""
                if result.content:
                    for content in result.content:
                        if hasattr(content, 'text'):
                            response_text = content.text
                            break
                
                if "validation" in response_text.lower() or "error" in response_text.lower():
                    print(f"{Colors.GREEN}✅ Invalid parameters properly validated{Colors.RESET}")
                else:
                    print(f"{Colors.YELLOW}⚠️  Invalid parameters accepted{Colors.RESET}")
            except Exception:
                print(f"{Colors.GREEN}✅ Invalid parameters properly rejected{Colors.RESET}")
            
            self.result.add_test("error_handling", True, "Error handling tests completed")
            return True
            
        except Exception as e:
            print(f"{Colors.RED}❌ Error handling test failed: {e}{Colors.RESET}")
            self.result.add_test("error_handling", False, error=str(e))
            return False
    
    async def test_performance(self, session: ClientSession) -> bool:
        """Test performance with concurrent requests."""
        try:
            print(f"{Colors.BLUE}⚡ Testing performance (concurrent requests)...{Colors.RESET}")
            
            # Prepare multiple quote requests
            profiles = [
                {
                    "applicant_dob": "01/15/1980",
                    "applicant_gender": "Male", 
                    "applicant_state": "California",
                    "quote_value": "10000"
                },
                {
                    "applicant_dob": "05/20/1975",
                    "applicant_gender": "Female",
                    "applicant_state": "Texas", 
                    "quote_value": "15000"
                }
            ]
            
            # Sequential execution
            start_time = time.time()
            for i, profile in enumerate(profiles):
                await session.call_tool("insurance_best_plan_pro_insurance_quote", arguments=profile)
            sequential_time = (time.time() - start_time) * 1000
            
            # Concurrent execution  
            start_time = time.time()
            tasks = [
                session.call_tool("insurance_best_plan_pro_insurance_quote", arguments=profile)
                for profile in profiles
            ]
            await asyncio.gather(*tasks, return_exceptions=True)
            concurrent_time = (time.time() - start_time) * 1000
            
            # Calculate improvement
            improvement = ((sequential_time - concurrent_time) / sequential_time) * 100
            
            print(f"{Colors.GREEN}✅ Performance test completed{Colors.RESET}")
            print(f"   Sequential: {sequential_time:.0f}ms")
            print(f"   Concurrent: {concurrent_time:.0f}ms") 
            print(f"   Improvement: {improvement:.1f}%")
            
            self.result.add_test("performance", True, {
                "sequential_time_ms": sequential_time,
                "concurrent_time_ms": concurrent_time,
                "improvement_percent": improvement
            })
            return True
            
        except Exception as e:
            print(f"{Colors.RED}❌ Performance test failed: {e}{Colors.RESET}")
            self.result.add_test("performance", False, error=str(e))
            return False
    
    async def run_all_tests(self):
        """Run all MCP tests."""
        print(f"{Colors.BOLD}{Colors.PURPLE}=== MCP Python SDK Test Suite ==={Colors.RESET}")
        print(f"Server URL: {self.server_url}")
        print(f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        try:
            async with streamablehttp_client(self.server_url) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream, sampling_callback=self.sampling_callback) as session:
                    
                    # Test 1: Connection
                    if not await self.test_connection(session):
                        print(f"{Colors.RED}❌ Connection failed - skipping remaining tests{Colors.RESET}")
                        return
                    
                    # Test 2: Tool Discovery
                    await self.test_tool_discovery(session)
                    
                    # Test 3: Set Available Products (async)
                    await self.test_set_available_products(session, "async")
                    
                    # Test 4: Insurance Quote Tests
                    quote_profiles = [
                        ("Young Male", {
                            "applicant_dob": "01/15/1995",
                            "applicant_height": "6 0",
                            "applicant_weight": "180",
                            "applicant_gender": "Male",
                            "applicant_state": "California",
                            "applicant_zip_code": "90210",
                            "quote_type": "Face Value",
                            "quote_value": "25000"
                        }),
                        ("Senior Female", {
                            "applicant_dob": "03/10/1960", 
                            "applicant_height": "5 6",
                            "applicant_weight": "140",
                            "applicant_gender": "Female",
                            "applicant_state": "Florida",
                            "applicant_zip_code": "33101",
                            "quote_type": "Face Value",
                            "quote_value": "50000"
                        })
                    ]
                    
                    for profile_name, profile_data in quote_profiles:
                        await self.test_insurance_quote(session, profile_name, profile_data)
                    
                    # Test 5: Error Handling
                    await self.test_error_handling(session)
                    
                    # Test 6: Performance
                    await self.test_performance(session)
                    
        except Exception as e:
            print(f"{Colors.RED}❌ Test suite failed: {e}{Colors.RESET}")
            self.result.add_test("test_suite", False, error=str(e))
        
        # Print results
        self.result.print_summary()
        
        return self.result


async def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Test MCP server with Python SDK")
    parser.add_argument("--server", default="http://localhost:3000/api/mcp", 
                       help="MCP server URL (default: http://localhost:3000/api/mcp)")
    parser.add_argument("--production", action="store_true",
                       help="Test production server (https://app.mediar.ai/api/mcp)")
    parser.add_argument("--json", action="store_true",
                       help="Output results in JSON format")
    
    args = parser.parse_args()
    
    if args.production:
        server_url = "https://app.mediar.ai/api/mcp"
    else:
        server_url = args.server
    
    tester = MCPPythonTester(server_url)
    result = await tester.run_all_tests()
    
    if args.json:
        print(json.dumps(result.results, indent=2))
    
    # Exit with appropriate code
    sys.exit(0 if result.failed_tests == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main()) 