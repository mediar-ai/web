#!/bin/bash
# Build and push OTEL collector to ACR

set -e

echo "Building OTEL collector image..."

# Get ACR name from terraform output (assuming terraform has been applied)
ACR_NAME=$(cd .. && terraform output -raw acr_login_server | cut -d'.' -f1)

if [ -z "$ACR_NAME" ]; then
    echo "Error: Could not get ACR name. Make sure terraform has been applied."
    exit 1
fi

echo "Using ACR: $ACR_NAME"

# Build and push image
echo "Building and pushing to ACR..."
az acr build --registry $ACR_NAME --image otel-collector:latest --file Dockerfile .

echo "Build complete! Image pushed to $ACR_NAME.azurecr.io/otel-collector:latest"
echo ""
echo "To update the deployment, run:"
echo "  cd .. && terraform apply -target=azurerm_container_group.telemetry_collector"