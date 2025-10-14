#!/bin/bash
set -e

echo "=== Manual Container Deployment ==="
echo "Using working image: dev-20251010-172535"

# Get ACR password
ACR_PASSWORD=$(az acr credential show -n mediarworkflowacr --query 'passwords[0].value' -o tsv)

# Create container with working image
az container create \
  --resource-group mediar-workflow-executor-rg \
  --name workflow-executor-dev \
  --image mediarworkflowacr.azurecr.io/workflow-executor:dev-20251010-172535 \
  --registry-login-server mediarworkflowacr.azurecr.io \
  --registry-username mediarworkflowacr \
  --registry-password "$ACR_PASSWORD" \
  --dns-name-label workflow-executor-dev \
  --ports 8080 \
  --cpu 1 \
  --memory 2 \
  --environment-variables \
    PORT=8080 \
    RUST_LOG=info \
    DATABASE_URL="$DATABASE_URL" \
  --os-type Linux

echo ""
echo "=== Waiting for container to start ==="
sleep 30

echo ""
echo "=== Testing health endpoint ==="
curl -v http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health

echo ""
echo "=== Getting container logs ==="
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg

echo ""
echo "✅ Deployment complete!"
