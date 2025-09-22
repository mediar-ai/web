#!/bin/bash
# Manual Modal deployment script

echo "🚀 Deploying Modal apps manually..."

# Navigate to modal_apps directory
cd modal_apps

# Deploy high_frequency_processor (our new simplified processor)
echo "📦 Deploying high_frequency_processor..."
modal deploy high_frequency_processor.py --name high-frequency-processor

# Deploy workflow_executor WITHOUT the schedule
echo "📦 Deploying workflow_executor (without schedule)..."
modal deploy workflow_executor.py --name workflow-executor

# List deployed apps
echo "✅ Deployed apps:"
modal app list

echo "🎉 Deployment complete!"