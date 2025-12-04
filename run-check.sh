#!/bin/bash
cd /c/Users/matt/mediar-web-app-workspace2
export DAYTONA_API_KEY=$(grep "^DAYTONA_API_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
node check-sandbox.mjs "$1"
