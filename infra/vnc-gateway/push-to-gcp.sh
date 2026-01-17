#!/bin/bash
# Push VNC Gateway image to GCP Artifact Registry

set -e

# Configuration
GCP_PROJECT="${GCP_PROJECT:-}"
GCP_REGION="${GCP_REGION:-us-east1}"
IMAGE_NAME="vnc-gateway"
REGISTRY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/mediar-containers"

if [ -z "$GCP_PROJECT" ]; then
    echo "Error: GCP_PROJECT environment variable required"
    echo "Usage: GCP_PROJECT=your-project-id ./push-to-gcp.sh"
    exit 1
fi

echo "=== Pushing VNC Gateway to GCP Artifact Registry ==="
echo "Project: $GCP_PROJECT"
echo "Region: $GCP_REGION"
echo "Registry: $REGISTRY"
echo ""

# Configure Docker to use gcloud credentials
echo "Configuring Docker authentication..."
gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev --quiet

# Build the image
echo "Building image..."
docker build -t ${IMAGE_NAME}:latest .

# Tag for GCP
echo "Tagging for GCP..."
docker tag ${IMAGE_NAME}:latest ${REGISTRY}/${IMAGE_NAME}:latest

# Push to GCP
echo "Pushing to Artifact Registry..."
docker push ${REGISTRY}/${IMAGE_NAME}:latest

echo ""
echo "=== Done ==="
echo "Image: ${REGISTRY}/${IMAGE_NAME}:latest"
