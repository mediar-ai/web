#!/bin/bash
cd /c/Users/matt/mediar-web-app-workspace2
export DAYTONA_API_KEY=$(grep "^DAYTONA_API_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
echo "Using API key: ${DAYTONA_API_KEY:0:10}..."
node cleanup-sandboxes.mjs
