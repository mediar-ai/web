#!/bin/bash
set -e

# ==============================================================================
# Azure Container Deployment Script for Rust Workflow Executor
# ==============================================================================
# Usage: ./deploy-azure.sh [environment]
# Environment: dev|staging|prod (default: dev)
# ==============================================================================

ENVIRONMENT="${1:-dev}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Configuration
RESOURCE_GROUP="mediar-workflow-executor-rg"
LOCATION="eastus"
ACR_NAME="mediarworkflowacr"
CONTAINER_NAME="workflow-executor-${ENVIRONMENT}"
IMAGE_NAME="workflow-executor"
IMAGE_TAG="${ENVIRONMENT}-${TIMESTAMP}"

# Container settings
CONTAINER_CPU=1
CONTAINER_MEMORY=2
PORT=8080

echo "=================================================================="
echo "🚀 Deploying Rust Workflow Executor to Azure"
echo "=================================================================="
echo "Environment:      $ENVIRONMENT"
echo "Resource Group:   $RESOURCE_GROUP"
echo "ACR:              $ACR_NAME"
echo "Image:            $IMAGE_NAME:$IMAGE_TAG"
echo "Container:        $CONTAINER_NAME"
echo "=================================================================="
echo ""

# ==============================================================================
# Step 1: Check Azure CLI and login status
# ==============================================================================
echo "📋 Step 1: Checking Azure CLI..."
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Please install: https://aka.ms/azure-cli"
    exit 1
fi

echo "✅ Azure CLI found: $(az version --query '"azure-cli"' -o tsv)"

# Check if logged in
if ! az account show &> /dev/null; then
    echo "🔐 Not logged in. Running az login..."
    az login
fi

ACCOUNT_NAME=$(az account show --query name -o tsv)
echo "✅ Logged in as: $ACCOUNT_NAME"
echo ""

# ==============================================================================
# Step 2: Create or verify resource group
# ==============================================================================
echo "📋 Step 2: Setting up resource group..."
if az group show --name "$RESOURCE_GROUP" &> /dev/null; then
    echo "✅ Resource group '$RESOURCE_GROUP' already exists"
else
    echo "🆕 Creating resource group '$RESOURCE_GROUP' in $LOCATION..."
    az group create \
        --name "$RESOURCE_GROUP" \
        --location "$LOCATION" \
        --output none
    echo "✅ Resource group created"
fi
echo ""

# ==============================================================================
# Step 3: Create or verify Azure Container Registry
# ==============================================================================
echo "📋 Step 3: Setting up Azure Container Registry..."
if az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null 2>&1; then
    echo "✅ ACR '$ACR_NAME' already exists"
else
    echo "🆕 Creating Azure Container Registry '$ACR_NAME'..."
    az acr create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$ACR_NAME" \
        --sku Basic \
        --admin-enabled true \
        --output none
    echo "✅ ACR created"
fi

# Get ACR login server
ACR_LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query loginServer -o tsv)
echo "🔗 ACR Login Server: $ACR_LOGIN_SERVER"
echo ""

# ==============================================================================
# Step 4: Build and push Docker image to ACR
# ==============================================================================
echo "📋 Step 4: Building and pushing Docker image..."
echo "🏗️  Building $IMAGE_NAME:$IMAGE_TAG in Azure..."

# Use optimized Dockerfile if available
DOCKERFILE_PATH="${DOCKERFILE:-Dockerfile}"
if [ -f "Dockerfile.optimized" ] && [ -z "$DOCKERFILE" ]; then
    DOCKERFILE_PATH="Dockerfile.optimized"
    echo "   ✅ Using optimized Dockerfile with cargo-chef caching"
fi

# Use ACR build task for cloud-based build with caching
az acr build \
    --registry "$ACR_NAME" \
    --image "${IMAGE_NAME}:${IMAGE_TAG}" \
    --image "${IMAGE_NAME}:${ENVIRONMENT}-latest" \
    --file "$DOCKERFILE_PATH" \
    . \
    --no-logs

echo "✅ Image built and pushed to ACR"
echo ""

# ==============================================================================
# Step 5: Get or create environment variables
# ==============================================================================
echo "📋 Step 5: Configuring environment variables..."

# Check if .env file exists
if [ -f ".env" ]; then
    echo "📄 Loading environment variables from .env file..."
    source .env
else
    echo "⚠️  No .env file found, using defaults"
fi

# Set default values if not in .env
DATABASE_URL="${DATABASE_URL:-postgresql://localhost/workflow_executor}"
MCP_ENDPOINT="${MCP_ENDPOINT:-http://localhost:3000}"
RUST_LOG="${RUST_LOG:-workflow_executor=debug,tower_http=debug,info}"
SUPABASE_URL="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

echo "✅ Environment configured"
echo "   DATABASE_URL: ${DATABASE_URL%%@*}@***"
echo "   MCP_ENDPOINT: $MCP_ENDPOINT"
echo "   SUPABASE_URL: ${SUPABASE_URL:-not set}"
echo "   SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:+***set***}"
echo ""

# ==============================================================================
# Step 6: Deploy to Azure Container Instances
# ==============================================================================
echo "📋 Step 6: Deploying to Azure Container Instances..."

# Get ACR credentials
ACR_USERNAME=$(az acr credential show --name "$ACR_NAME" --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$ACR_NAME" --query "passwords[0].value" -o tsv)

# Delete existing container if it exists
if az container show --name "$CONTAINER_NAME" --resource-group "$RESOURCE_GROUP" &> /dev/null 2>&1; then
    echo "🗑️  Deleting existing container..."
    az container delete \
        --name "$CONTAINER_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --yes \
        --output none
    echo "✅ Old container deleted"
fi

echo "🚢 Deploying new container..."

# ==============================================================================
# Dynamically discover OTEL collector endpoint
# ==============================================================================
echo "🔍 Discovering OTEL collector endpoint..."

# Try to find OTEL collector by name pattern
OTEL_FQDN=$(az container list --query "[?contains(name, 'otel')].ipAddress.fqdn" -o tsv | head -n 1)

if [ -n "$OTEL_FQDN" ]; then
    OTEL_ENDPOINT="http://${OTEL_FQDN}:4318"
    echo "✅ Found OTEL collector: $OTEL_ENDPOINT"
else
    # Fallback to known endpoint if discovery fails
    OTEL_ENDPOINT="http://otel-collector-mcp-vm2-rg.eastus.azurecontainer.io:4318"
    echo "⚠️  Could not discover OTEL collector, using fallback: $OTEL_ENDPOINT"
fi

# Build environment variables array
ENV_VARS=(
    "PORT=$PORT"
    "RUST_LOG=$RUST_LOG"
    "DATABASE_URL=$DATABASE_URL"
    "MCP_ENDPOINT=$MCP_ENDPOINT"
    "ENVIRONMENT=$ENVIRONMENT"
    "OTEL_SDK_ENABLED=true"
    "OTEL_EXPORTER_OTLP_ENDPOINT=$OTEL_ENDPOINT"
    "AZURE_CONTAINER_NAME=$CONTAINER_NAME"
    "AZURE_RESOURCE_GROUP=$RESOURCE_GROUP"
)

# Add Supabase credentials if available
if [ -n "$SUPABASE_URL" ]; then
    ENV_VARS+=("SUPABASE_URL=$SUPABASE_URL")
    echo "   ✅ Including SUPABASE_URL in deployment"
fi

if [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    ENV_VARS+=("SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY")
    echo "   ✅ Including SUPABASE_SERVICE_ROLE_KEY in deployment"
fi

# Add Monitor API credentials if available
if [ -n "$APP_URL" ]; then
    ENV_VARS+=("APP_URL=$APP_URL")
    echo "   ✅ Including APP_URL in deployment"
fi

if [ -n "$MEDIAR_SERVICE_API_KEY" ]; then
    ENV_VARS+=("MEDIAR_SERVICE_API_KEY=$MEDIAR_SERVICE_API_KEY")
    echo "   ✅ Including MEDIAR_SERVICE_API_KEY in deployment"
fi

# Add secrets encryption key if available
if [ -n "$SECRETS_ENCRYPTION_KEY" ]; then
    ENV_VARS+=("SECRETS_ENCRYPTION_KEY=$SECRETS_ENCRYPTION_KEY")
    echo "   ✅ Including SECRETS_ENCRYPTION_KEY in deployment"
fi

# Add MCP service token for workflow downloads
if [ -n "$MCP_SERVICE_TOKEN" ]; then
    ENV_VARS+=("MCP_SERVICE_TOKEN=$MCP_SERVICE_TOKEN")
    echo "   ✅ Including MCP_SERVICE_TOKEN in deployment"
fi

az container create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CONTAINER_NAME" \
    --image "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}" \
    --os-type Linux \
    --cpu "$CONTAINER_CPU" \
    --memory "$CONTAINER_MEMORY" \
    --registry-login-server "$ACR_LOGIN_SERVER" \
    --registry-username "$ACR_USERNAME" \
    --registry-password "$ACR_PASSWORD" \
    --dns-name-label "${CONTAINER_NAME}" \
    --ports "$PORT" \
    --environment-variables "${ENV_VARS[@]}" \
    --output none

echo "✅ Container deployed"
echo ""

# ==============================================================================
# Step 7: Get container details and test endpoint
# ==============================================================================
echo "📋 Step 7: Verifying deployment..."

# Get public IP/FQDN
FQDN=$(az container show \
    --name "$CONTAINER_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query ipAddress.fqdn -o tsv)

PUBLIC_IP=$(az container show \
    --name "$CONTAINER_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query ipAddress.ip -o tsv)

echo "✅ Container is running"
echo ""

# Wait for container to be ready
echo "⏳ Waiting for container to start (30 seconds)..."
sleep 30

# Test health endpoint
HEALTH_URL="http://${FQDN}:${PORT}/api/v1/health"
echo "🏥 Testing health endpoint: $HEALTH_URL"

if curl -s -f "$HEALTH_URL" > /dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s "$HEALTH_URL")
    echo "✅ Health check passed!"
    echo "   Response: $HEALTH_RESPONSE"
else
    echo "⚠️  Health check not responding yet (container may still be starting)"
fi

echo ""
echo "=================================================================="
echo "✅ Deployment Complete!"
echo "=================================================================="
echo ""
echo "🌐 Public API Endpoints:"
echo "   Base URL:        http://${FQDN}:${PORT}"
echo "   Health Check:    http://${FQDN}:${PORT}/api/v1/health"
echo "   Workflows:       http://${FQDN}:${PORT}/api/v1/workflows"
echo "   Executions:      http://${FQDN}:${PORT}/api/v1/executions"
echo "   Queue Status:    http://${FQDN}:${PORT}/api/v1/queue/status"
echo ""
echo "📊 Container Details:"
echo "   Name:            $CONTAINER_NAME"
echo "   Image:           ${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}"
echo "   Public IP:       $PUBLIC_IP"
echo "   FQDN:            $FQDN"
echo "   Port:            $PORT"
echo "   CPU:             $CONTAINER_CPU core(s)"
echo "   Memory:          $CONTAINER_MEMORY GB"
echo ""
echo "🔧 Management Commands:"
echo "   View logs:       az container logs -n $CONTAINER_NAME -g $RESOURCE_GROUP"
echo "   Restart:         az container restart -n $CONTAINER_NAME -g $RESOURCE_GROUP"
echo "   Delete:          az container delete -n $CONTAINER_NAME -g $RESOURCE_GROUP -y"
echo "   SSH:             az container exec -n $CONTAINER_NAME -g $RESOURCE_GROUP --exec-command /bin/bash"
echo ""
echo "📝 Save this URL for the dashboard:"
echo "   export RUST_EXECUTOR_URL=\"http://${FQDN}:${PORT}\""
echo ""
echo "=================================================================="
