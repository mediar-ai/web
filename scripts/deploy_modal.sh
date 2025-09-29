#!/bin/bash
# Deploy Modal apps - run this from WSL or CI/CD

set -e

echo "Deploying Modal apps..."

# Export Modal token if available
if [ -n "$MODAL_TOKEN_ID" ] && [ -n "$MODAL_TOKEN_SECRET" ]; then
    modal token set --token-id "$MODAL_TOKEN_ID" --token-secret "$MODAL_TOKEN_SECRET"
fi

# Deploy each app
echo "Deploying workflow-executor..."
modal deploy modal_apps/workflow_executor.py --name workflow-executor

echo "Deploying sequential-workflow-synthesizer..."
modal deploy modal_apps/workflow_synthesis_orchestrator.py --name sequential-workflow-synthesizer

echo "Deploying labeling-data-processor..."
modal deploy modal_apps/labeling_data_processor.py --name labeling-data-processor

echo "Deploying sync-processor..."
modal deploy modal_apps/sync_processor.py --name sync-processor

echo "Modal apps deployed successfully!"