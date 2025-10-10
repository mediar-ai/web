# 🚀 One-Liner Azure Deployment

## Quick Deploy

```bash
# Deploy to dev environment
./deploy.sh

# Deploy to production
./deploy.sh prod

# Deploy to staging
./deploy.sh staging
```

That's it! The script handles everything automatically.

---

## What It Does

The deployment script automatically:
1. ✅ Checks Azure CLI and login status
2. ✅ Creates resource group if needed
3. ✅ Creates Azure Container Registry if needed
4. ✅ Builds Docker image in the cloud (no local Docker needed!)
5. ✅ Pushes image to ACR
6. ✅ Deploys to Azure Container Instances
7. ✅ Configures public DNS and IP
8. ✅ Tests the health endpoint
9. ✅ Outputs public API URLs

---

## First Time Setup

### 1. Install Azure CLI (if not installed)
```bash
# macOS
brew install azure-cli

# Windows
winget install Microsoft.AzureCLI

# Linux
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

### 2. Login to Azure
```bash
az login
```

### 3. (Optional) Configure Environment
Create a `.env` file in the `rust-executor` directory:
```bash
DATABASE_URL=postgresql://user:pass@host:5432/dbname
MCP_ENDPOINT=http://your-mcp-server:3000
RUST_LOG=workflow_executor=debug,tower_http=debug
```

If no `.env` file exists, defaults will be used.

---

## Deployment Outputs

After deployment, you'll get:

```
✅ Deployment Complete!

🌐 Public API Endpoints:
   Base URL:        http://workflow-executor-dev.eastus.azurecontainer.io:8080
   Health Check:    http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
   Workflows:       http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/workflows
   Executions:      http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/executions
```

---

## Testing the Deployment

### Test Health Endpoint
```bash
curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "0.1.0"
}
```

### Test Workflow Execution
```bash
curl -X POST http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/executions \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "your-workflow-uuid",
    "execution_params": {"url": "https://example.com"},
    "mcp_endpoint": "http://localhost:3000"
  }'
```

---

## Management Commands

### View Logs
```bash
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
```

### Restart Container
```bash
az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg
```

### Delete Deployment
```bash
az container delete -n workflow-executor-dev -g mediar-workflow-executor-rg -y
```

### SSH into Container
```bash
az container exec -n workflow-executor-dev -g mediar-workflow-executor-rg --exec-command /bin/bash
```

---

## Environments

The deployment script supports multiple environments:

| Environment | Command | Container Name | DNS |
|-------------|---------|----------------|-----|
| Development | `./deploy.sh dev` | workflow-executor-dev | workflow-executor-dev.eastus.azurecontainer.io |
| Staging | `./deploy.sh staging` | workflow-executor-staging | workflow-executor-staging.eastus.azurecontainer.io |
| Production | `./deploy.sh prod` | workflow-executor-prod | workflow-executor-prod.eastus.azurecontainer.io |

Each environment is completely isolated with its own container instance.

---

## Costs

Azure Container Instances pricing (as of 2024):
- **CPU**: ~$0.0000125 per vCPU-second
- **Memory**: ~$0.0000014 per GB-second
- **For 1 vCPU, 2GB RAM running 24/7**: ~$37/month

The deployment script uses:
- 1 vCPU
- 2 GB RAM
- Public IP (included)

---

## Troubleshooting

### Container Won't Start
```bash
# Check container status
az container show -n workflow-executor-dev -g mediar-workflow-executor-rg

# View detailed logs
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg --follow
```

### Health Check Fails
- Wait 1-2 minutes for container to fully start
- Check logs for database connection errors
- Verify environment variables are set correctly

### Build Fails
```bash
# Check ACR build logs
az acr task logs --registry mediarworkflowacr
```

---

## CI/CD Integration

### GitHub Actions
```yaml
name: Deploy to Azure

on:
  push:
    branches: [main]
    paths:
      - 'rust-executor/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Azure Login
        uses: azure/login@v1
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Deploy
        run: |
          cd rust-executor
          ./deploy.sh prod
```

---

## Advanced Configuration

### Custom Resource Names
Edit `deploy-azure.sh`:
```bash
RESOURCE_GROUP="my-custom-rg"
ACR_NAME="mycustomacr"
LOCATION="westus2"
```

### Container Scaling
Edit `deploy-azure.sh`:
```bash
CONTAINER_CPU=2      # CPU cores
CONTAINER_MEMORY=4   # GB RAM
```

### Add Secrets
```bash
az container create \
  ... \
  --secure-environment-variables \
      DATABASE_PASSWORD="secret123" \
      API_KEY="abc123"
```

---

## Next Steps

1. ✅ Deploy to dev: `./deploy.sh dev`
2. ✅ Test API endpoints
3. ✅ Monitor logs
4. ✅ Deploy to prod: `./deploy.sh prod`
5. 🔧 Integrate with dashboard (see DEPLOYMENT_COMPATIBILITY.md)

---

## Support

- **Script issues**: Check `deploy-azure.sh` comments
- **Azure issues**: `az container --help`
- **API issues**: Check container logs
- **Build issues**: Review Dockerfile

**Need help?** Open an issue with:
- Error message
- Output from `az container logs`
- Output from `az container show`