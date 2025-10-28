#!/bin/bash
# Get Guacamole auth token from new HTTPS endpoint
TOKEN_RESPONSE=$(curl -s -X POST https://agent.mediar.ai/guacamole/api/tokens \
  -d "username=admin&password=mediar123")

TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"authToken":"[^"]*' | cut -d'"' -f4)
DATASOURCE=$(echo $TOKEN_RESPONSE | grep -o '"dataSource":"[^"]*' | cut -d'"' -f4)

echo "Available Guacamole connections:"
curl -s "https://agent.mediar.ai/guacamole/api/session/data/${DATASOURCE}/connections?token=${TOKEN}" | jq 'to_entries | .[] | {id: .key, name: .value.name}'
