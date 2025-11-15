#!/bin/bash
export DATABASE_URL="postgresql://postgres.eshwntsgsputksqamckh:***REMOVED***@aws-0-us-west-1.pooler.supabase.com:5432/postgres"
export SUPABASE_URL="https://eshwntsgsputksqamckh.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="***REMOVED***"
export GITHUB_TOKEN="***REMOVED***"
export APP_URL="https://www.mediar.ai"
export MCP_ENDPOINT="http://20.169.144.86:3000"
export RUST_LOG=info,workflow_executor=debug

echo "Starting rust-executor to process execution 22036..."
./target/release/workflow-executor queue
