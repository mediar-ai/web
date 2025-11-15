#!/bin/bash
export DATABASE_URL="postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
export SUPABASE_URL="https://eshwntsgsputksqamckh.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzaHdudHNnc3B1dGtzcWFtY2toIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzAwODk4NCwiZXhwIjoyMDQ4NTg0OTg0fQ.60wcQZuuqLuGcNTYwf8ZRFl_qtpJcN-unvY3avGQZi0"
export GITHUB_TOKEN="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"
export APP_URL="https://www.mediar.ai"
export MCP_ENDPOINT="http://20.169.144.86:3000"
export RUST_LOG=info,workflow_executor=debug

echo "Starting rust-executor to process execution 22036..."
./target/release/workflow-executor queue
