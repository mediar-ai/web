#!/bin/bash

# Test MCP health endpoint for remote machines
# Usage: ./test-mcp-health.sh <machine_url>

MACHINE_URL=${1:-"http://172.178.65.145:8080"}

echo "Testing MCP health check on: $MACHINE_URL"
echo "========================================="

# Remove trailing slash if present
MACHINE_URL="${MACHINE_URL%/}"

# Test MCP endpoint with get_applications method
echo -e "\n1. Testing MCP get_applications method..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$MACHINE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  --max-time 5 \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "mcp_terminator-mcp-agent_get_applications",
    "params": {}
  }' 2>/dev/null)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" == "200" ]; then
  echo "Response:"
  echo "$BODY" | python -m json.tool 2>/dev/null || echo "$BODY"

  # Check if taskbar is present
  if echo "$BODY" | grep -qi "taskbar\|shell_traywnd"; then
    echo -e "\n✓ HEALTHY: Taskbar found - UI Automation is working"
  else
    echo -e "\n✗ UNHEALTHY: No taskbar found - UI Automation may not be working"
  fi
else
  echo "✗ FAILED: Could not reach MCP endpoint"
fi

echo -e "\n========================================="
echo "Test complete"