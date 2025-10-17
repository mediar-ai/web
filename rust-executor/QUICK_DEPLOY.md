# 🚀 Quick Deployment Guide

## Automatic Deployment (Recommended)

**Just push to main and it auto-deploys!** ✨

When you push changes to `rust-executor/**`, GitHub Actions automatically:
1. Builds the Docker image
2. Pushes to Azure Container Registry
3. Deploys to Azure Container Instances
4. Tests the health endpoint
5. Reports success/failure

### First Time Setup (One Time Only)

1. **Create Azure Service Principal**
```bash
az ad sp create-for-rbac \
  --name "github-mediar-workflow-executor" \
  --role contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID \
  --sdk-auth
```

2. **Add GitHub Secret**
- Go to: https://github.com/mediar-ai/mediar-web-app/settings/secrets/actions
- Click "New repository secret"
- Name: `AZURE_CREDENTIALS`
- Value: Paste the entire JSON output from step 1

3. **Done!** Now every push to `rust-executor/**` auto-deploys.

---

## Manual Deployment (When You Need It)

### Quick Deploy
```bash
cd rust-executor
./deploy.sh           # Deploy to dev
./deploy.sh prod      # Deploy to production
```

### From Project Root
```bash
npm run deploy:rust           # Deploy to dev
npm run deploy:rust:prod      # Deploy to production
```

---

## Deployment Status

Check GitHub Actions: https://github.com/mediar-ai/mediar-web-app/actions

Or check container directly:
```bash
# Health check
curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health

# Queue status
curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/queue/status

# View logs
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg --follow
```

---

## Rollback

If deployment fails or has issues:

```bash
# Restart container
az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg

# Or redeploy previous version
git checkout <previous-commit>
cd rust-executor
./deploy.sh
```

---

## Typical Deployment Time

- **Automatic (GitHub Actions)**: 3-5 minutes
- **Manual (./deploy.sh)**: 2-3 minutes
- **Build time**: ~1-2 minutes
- **Container startup**: ~30 seconds

---

## What Gets Deployed

- **Container Image**: Built from `rust-executor/Dockerfile`
- **Environment**: Development (dev) or Production (prod)
- **Resources**: 1 vCPU, 2GB RAM, Public IP
- **Cost**: ~$37/month per container

---

## Troubleshooting

### GitHub Actions fails
- Check logs: https://github.com/mediar-ai/mediar-web-app/actions
- Verify Azure credentials secret is set
- Check if Azure CLI can authenticate

### Container won't start
```bash
# View detailed status
az container show -n workflow-executor-dev -g mediar-workflow-executor-rg

# Check logs
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg

# Restart
az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg
```

### Health check fails
- Wait 1-2 minutes for container to fully start
- Check DATABASE_URL environment variable
- Verify database connectivity

---

## Making Changes

1. Edit code in `rust-executor/`
2. Commit and push to main: `git push origin main`
3. Watch GitHub Actions: https://github.com/mediar-ai/mediar-web-app/actions
4. Verify health: `curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health`

That's it! No manual deployment needed. ✨
