# ⚡ Rust Workflow Executor - Quick Start

## 🎯 TL;DR - Deploy in One Line

```bash
cd rust-executor
./deploy.sh
```

Wait 5 minutes, get a public API! 🚀

---

## 📦 What You Get

After deployment, you'll have:

✅ **Public REST API** running on Azure
✅ **Automatic DNS** with friendly URL
✅ **Container scaling** (1 CPU, 2GB RAM)
✅ **Health monitoring** built-in
✅ **Zero infrastructure** to manage

---

## 🚀 Deployment Methods

### Method 1: One-Liner (Recommended)
```bash
./deploy.sh         # Deploy to dev
./deploy.sh prod    # Deploy to production
```

### Method 2: Using Make
```bash
make deploy         # Deploy to dev
make deploy-prod    # Deploy to prod
make logs           # View logs
make health-dev     # Check if it's running
```

### Method 3: Manual Azure CLI
```bash
# Build image
az acr build --registry mediarworkflowacr --image workflow-executor:latest .

# Deploy container
az container create \
  --resource-group mediar-workflow-executor-rg \
  --name workflow-executor-dev \
  --image mediarworkflowacr.azurecr.io/workflow-executor:latest \
  --dns-name-label workflow-executor-dev \
  --ports 8080
```

---

## 🧪 Testing Your Deployment

### 1. Get Your URL
After deployment, you'll see:
```
🌐 Public API Endpoints:
   Base URL: http://workflow-executor-dev.eastus.azurecontainer.io:8080
```

### 2. Test Health Endpoint
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

### 3. Test Workflow Execution
```bash
curl -X POST http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/executions \
  -H "Content-Type: application/json" \
  -d '{
    "workflow_id": "550e8400-e29b-41d4-a716-446655440000",
    "execution_params": {
      "url": "https://example.com",
      "action": "screenshot"
    },
    "mcp_endpoint": "http://localhost:3000",
    "client_id": "test-client-123"
  }'
```

---

## 📊 Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/health` | GET | Health check |
| `/api/v1/workflows` | GET | List all workflows |
| `/api/v1/workflows/:id` | GET | Get workflow details |
| `/api/v1/executions` | POST | Create new execution |
| `/api/v1/executions/:id` | GET | Get execution status |
| `/api/v1/executions/:id/cancel` | POST | Cancel execution |
| `/api/v1/queue/status` | GET | Queue statistics |

---

## 🔧 Common Tasks

### View Logs
```bash
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
```

Or with Make:
```bash
make logs
```

### Restart Container
```bash
az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg
```

Or:
```bash
make restart
```

### Check Status
```bash
make status
```

### Delete Deployment
```bash
az container delete -n workflow-executor-dev -g mediar-workflow-executor-rg -y
```

---

## 🎨 Environments

Deploy to different environments:

```bash
./deploy.sh dev      # Development
./deploy.sh staging  # Staging
./deploy.sh prod     # Production
```

Each gets its own:
- Container instance
- Public DNS name
- Isolated environment

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file:
```bash
DATABASE_URL=postgresql://user:pass@host/db
MCP_ENDPOINT=http://your-mcp-server:3000
RUST_LOG=workflow_executor=debug,tower_http=info
```

The deployment script automatically uses these.

### Scaling

Edit `deploy-azure.sh`:
```bash
CONTAINER_CPU=2      # 2 CPU cores
CONTAINER_MEMORY=4   # 4 GB RAM
```

---

## 💰 Costs

Current configuration (1 vCPU, 2GB RAM):
- **Per month**: ~$37 running 24/7
- **Per day**: ~$1.20
- **Per hour**: ~$0.05

Scale up/down as needed!

---

## 🐛 Troubleshooting

### Container won't start
```bash
# Check status
az container show -n workflow-executor-dev -g mediar-workflow-executor-rg

# View logs
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
```

### Health check fails
- Wait 1-2 minutes after deployment
- Check logs for errors
- Verify DATABASE_URL is set correctly

### Build fails
```bash
# Check build logs
az acr task logs --registry mediarworkflowacr
```

---

## 📚 Next Steps

1. ✅ Deploy: `./deploy.sh`
2. ✅ Test endpoints
3. ✅ Monitor logs: `make logs`
4. 🔧 Integrate with dashboard (see [DEPLOYMENT_COMPATIBILITY.md](DEPLOYMENT_COMPATIBILITY.md))
5. 🚀 Deploy to prod: `./deploy.sh prod`

---

## 🆘 Need Help?

- **Deployment issues**: Check [DEPLOY.md](DEPLOY.md)
- **API usage**: Check [README.md](README.md)
- **Compatibility**: Check [DEPLOYMENT_COMPATIBILITY.md](DEPLOYMENT_COMPATIBILITY.md)
- **Testing**: Check [TEST_REPORT.md](TEST_REPORT.md)

---

## ✨ Features

✅ **Zero-downtime deployments** - Rolling updates
✅ **Auto-scaling** - Adjust resources on demand
✅ **Health monitoring** - Built-in health checks
✅ **Public DNS** - Friendly URLs automatically
✅ **HTTPS ready** - Add Azure Front Door later
✅ **Multi-environment** - dev/staging/prod isolated
✅ **One-command rollback** - Redeploy previous version

---

**Ready to deploy?**

```bash
cd rust-executor
./deploy.sh
```

🎉 That's it!