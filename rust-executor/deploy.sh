#!/bin/bash
# One-liner deployment: ./deploy.sh
# With environment: ./deploy.sh prod
./deploy-azure.sh "${1:-dev}"