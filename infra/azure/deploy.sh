#!/bin/bash
# Deploy VNC Gateway to Azure Container Instance
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Docker installed
#   - Terraform initialized (terraform init)
#
# Usage:
#   ./deploy.sh              # Deploy with existing terraform.tfvars
#   ./deploy.sh --build-only # Just build and push image, no terraform apply

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VNC_GATEWAY_DIR="$SCRIPT_DIR/../vnc-gateway"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[VNC Gateway]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check prerequisites
command -v az >/dev/null 2>&1 || error "Azure CLI not found. Install: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
command -v docker >/dev/null 2>&1 || error "Docker not found"
command -v terraform >/dev/null 2>&1 || error "Terraform not found"

# Check Azure login
az account show >/dev/null 2>&1 || error "Not logged in to Azure. Run: az login"

# Get ACR details from terraform output or tfvars
cd "$SCRIPT_DIR"

if [ ! -f "terraform.tfvars" ]; then
  error "terraform.tfvars not found. Create it with:\n  supabase_url = \"...\"\n  supabase_key = \"...\"\n  vnc_password = \"...\""
fi

# Initialize terraform if needed
if [ ! -d ".terraform" ]; then
  log "Initializing terraform..."
  terraform init
fi

# Get ACR name from tfvars or use default
ACR_NAME=$(grep -E "^acr_name" terraform.tfvars 2>/dev/null | cut -d'"' -f2 || echo "mediarvncgateway")
ACR_LOGIN_SERVER="${ACR_NAME}.azurecr.io"
RESOURCE_GROUP=$(grep -E "^resource_group_name" terraform.tfvars 2>/dev/null | cut -d'"' -f2 || echo "mediar-vnc-gateway-rg")

log "ACR: $ACR_LOGIN_SERVER"
log "Resource Group: $RESOURCE_GROUP"

# Check if ACR exists (create via terraform if not)
if ! az acr show --name "$ACR_NAME" >/dev/null 2>&1; then
  log "ACR not found. Running terraform apply to create infrastructure..."
  terraform apply -auto-approve
fi

# Login to ACR
log "Logging in to ACR..."
az acr login --name "$ACR_NAME"

# Build and push image
log "Building VNC gateway image..."
docker build -t "$ACR_LOGIN_SERVER/vnc-gateway:latest" "$VNC_GATEWAY_DIR"

log "Pushing image to ACR..."
docker push "$ACR_LOGIN_SERVER/vnc-gateway:latest"

if [ "$1" = "--build-only" ]; then
  log "Build complete (--build-only specified, skipping terraform apply)"
  exit 0
fi

# Apply terraform (updates container instance with new image)
log "Applying terraform..."
terraform apply -auto-approve

# Get outputs
FQDN=$(terraform output -raw vnc_gateway_fqdn 2>/dev/null || echo "")
IP=$(terraform output -raw vnc_gateway_ip 2>/dev/null || echo "")

log "Deployment complete!"
echo ""
echo "VNC Gateway endpoints:"
echo "  HTTP:  http://$FQDN:8080"
echo "  IP:    http://$IP:8080"
echo "  Health: http://$FQDN:8080/health"
echo ""
echo "NOTE: ACI doesn't support HTTPS natively."
echo "For HTTPS, add Azure Application Gateway or use Cloudflare proxy."
