#!/bin/bash
# One-liner deployment: ./scripts/deploy.sh
# With environment: ./scripts/deploy.sh prod
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
"$SCRIPT_DIR/deploy-azure.sh" "${1:-dev}"