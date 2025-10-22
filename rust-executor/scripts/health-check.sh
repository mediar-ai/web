#!/bin/bash
set -e

# ==============================================================================
# Health Check Script for Rust Workflow Executor
# ==============================================================================
# Usage: ./health-check.sh [url] [max_retries] [initial_wait]
# ==============================================================================

HEALTH_URL="${1:-http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health}"
MAX_RETRIES="${2:-5}"
INITIAL_WAIT="${3:-90}"

echo "=================================================================="
echo "🏥 Health Check for Rust Workflow Executor"
echo "=================================================================="
echo "URL:          $HEALTH_URL"
echo "Max Retries:  $MAX_RETRIES"
echo "Initial Wait: ${INITIAL_WAIT}s"
echo "=================================================================="
echo ""

# Wait for container to be ready (longer timeout for first startup)
echo "⏳ Waiting for container to fully start (${INITIAL_WAIT} seconds)..."
sleep "$INITIAL_WAIT"

# Test health endpoint with retries
echo "🔍 Testing health endpoint: $HEALTH_URL"
echo ""

RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  RESPONSE=$(curl -s -w "\n%{http_code}" "$HEALTH_URL" || echo "000")
  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | head -n-1)

  echo "Attempt $((RETRY_COUNT + 1))/$MAX_RETRIES - Response: $BODY"
  echo "HTTP Code: $HTTP_CODE"

  if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo "=================================================================="
    echo "✅ Health check passed!"
    echo "=================================================================="
    exit 0
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
    echo "⏳ Waiting 15 seconds before retry..."
    echo ""
    sleep 15
  fi
done

echo ""
echo "=================================================================="
echo "❌ Health check failed after $MAX_RETRIES attempts"
echo "=================================================================="
exit 1
