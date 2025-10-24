#!/bin/bash
# Test script to verify MCP integration with local server

echo "Testing MCP client against local server at http://127.0.0.1:8080"
echo ""

# Test 1: Initialize connection
echo "Test 1: Initialize MCP connection"
curl -X POST http://127.0.0.1:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"rust-executor-test","version":"0.1.4"}}}' \
  -i | grep -E "(HTTP|Mcp-Session-Id)" | head -5

echo ""
echo ""

# Test 2: List available tools
echo "Test 2: List available MCP tools"
curl -X POST http://127.0.0.1:8080/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Mcp-Session-Id: test-session-123" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  2>/dev/null | head -20

echo ""
echo "Tests complete!"
