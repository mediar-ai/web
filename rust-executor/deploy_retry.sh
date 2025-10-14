#!/bin/bash
set -e

echo "🔄 Deployment with automatic retries"
MAX_ATTEMPTS=5
ATTEMPT=1

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
  echo ""
  echo "=== ATTEMPT $ATTEMPT/$MAX_ATTEMPTS ==="
  
  if ./deploy.sh dev 2>&1; then
    echo "✅ DEPLOYMENT SUCCEEDED!"
    exit 0
  else
    EXIT_CODE=$?
    echo "❌ Attempt $ATTEMPT failed (exit code: $EXIT_CODE)"
    
    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
      WAIT_TIME=$((10 * ATTEMPT))
      echo "⏳ Waiting ${WAIT_TIME}s before retry..."
      sleep $WAIT_TIME
    fi
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
done

echo ""
echo "❌ All $MAX_ATTEMPTS attempts failed"
exit 1
