#!/bin/bash

# Script to run rust-executor locally for testing TypeScript workflows
# This will connect to the production database and remote MCP server

# Set environment variables for local testing
export DATABASE_URL="postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
export SUPABASE_URL="https://eshwntsgsputksqamckh.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0"

# GitHub token for loading workflows
export GITHUB_TOKEN="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"

# App URL (for monitor notifications)
export APP_URL="https://www.mediar.ai"

# Service API key (if needed)
export MEDIAR_SERVICE_API_KEY="f8a5c2b1-5e9d-4a1c-9b0d-3a2b1c0d4e5f"

# MCP Endpoint - This should be the actual VM endpoint
# We'll need to determine this from the execution params or use a default
# Using vm1 as the default fallback (172.190.244.122:8080)
export MCP_ENDPOINT="${1:-http://172.190.244.122:8080}"

# Rust logging
export RUST_LOG=info,workflow_executor=debug

echo "================================"
echo "Rust Executor Local Test Runner"
echo "================================"
echo ""
echo "Environment:"
echo "  DATABASE_URL: [connected to production]"
echo "  MCP_ENDPOINT: $MCP_ENDPOINT"
echo "  RUST_LOG: $RUST_LOG"
echo ""
echo "Starting rust-executor in queue processor mode..."
echo "This will pick up 'queued' executions with executor_type='rust'"
echo ""
echo "Press Ctrl+C to stop"
echo "================================"
echo ""

# Build and run the rust-executor
cd "$(dirname "$0")"
cargo build --release && ./target/release/workflow-executor queue