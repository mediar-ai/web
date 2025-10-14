# Azure Deployment Instructions - Rust Workflow Executor

## ✅ Status: Code is Ready!

The Docker image has been successfully built and is ready to deploy:
- **Image**: `mediarworkflowacr.azurecr.io/workflow-executor:dev-latest`
- **Digest**: `sha256:358dce36caf6ee8101098bb2cae180a30252537aefeac9d8f74b154b625f7f75`
- **Build**: Completed successfully on 2025-10-12
- **All fixes applied**: GLIBC compatibility, curl for healthcheck, debug logging

## ⚠️ Issue: Azure CLI Unstable

Azure CLI is experiencing connection issues from your machine. Deploy manually via Azure Portal.

---

## 🚀 Manual Deployment via Azure Portal

### Step 1: Navigate to Azure Portal
1. Open browser: https://portal.azure.com
2. Sign in with your account
3. Go to: **Container Instances** → **Create**

### Step 2: Basics Configuration
- **Resource Group**: `mediar-workflow-executor-rg` (select existing)
- **Container name**: `workflow-executor-dev`
- **Region**: `East US`
- **Image source**: `Azure Container Registry`
- **Registry**: `mediarworkflowacr`
- **Image**: `workflow-executor`
- **Image tag**: `dev-latest`

### Step 3: Networking Configuration
- **Networking type**: `Public`
- **DNS name label**: `workflow-executor-dev`
- **Ports**: `8080` (TCP)

### Step 4: Advanced Configuration
- **Restart policy**: `On failure`
- **CPU**: `1 core`
- **Memory**: `2 GB`

### Step 5: Environment Variables
Add these three variables:

| Name | Value | Type |
|------|-------|------|
| `PORT` | `8080` | Plain text |
| `RUST_LOG` | `info` | Plain text |
| `DATABASE_URL` | `postgresql://postgres.eshwntsgsputksqamckh:dS64xX6mU3E4Sbyc@aws-0-us-west-1.pooler.supabase.com:5432/postgres` | Secure |

**IMPORTANT**: Set `DATABASE_URL` as "Secure" to hide the password!

### Step 6: Review and Create
1. Click **Review + create**
2. Wait ~2 minutes for deployment
3. Once deployed, note the FQDN

---

## 🧪 Testing the Deployment

### Health Check
```bash
curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
```

Expected response:
```json
{"status":"healthy"}
```

### View Logs
```bash
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
```

You should see:
```
=== STARTING WORKFLOW EXECUTOR ===
=== RUST EXECUTOR STARTING ===
Environment: PORT=8080, RUST_LOG=info
✓ Successfully connected to database
Server listening on 0.0.0.0:8080
```

### API Endpoints
- Base URL: `http://workflow-executor-dev.eastus.azurecontainer.io:8080`
- Health: `/api/v1/health`
- Workflows: `/api/v1/workflows`
- Executions: `/api/v1/executions`
- Queue Status: `/api/v1/queue/status`

---

## 🔧 Management Commands

### View Logs
```bash
az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
```

### Restart Container
```bash
az container restart -n workflow-executor-dev -g mediar-workflow-executor-rg
```

### Delete Container
```bash
az container delete -n workflow-executor-dev -g mediar-workflow-executor-rg -y
```

### SSH into Container
```bash
az container exec -n workflow-executor-dev -g mediar-workflow-executor-rg --exec-command /bin/bash
```

---

## 🐛 Debugging

### If Container Crash-Loops

1. **Check logs immediately after crash**:
   ```bash
   az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
   ```

2. **Common issues**:
   - Database connection timeout → Check DATABASE_URL is correct
   - Port already in use → Check no other container using port 8080
   - Image pull failed → Verify ACR credentials

3. **View container events**:
   ```bash
   az container show -n workflow-executor-dev -g mediar-workflow-executor-rg \
     --query "containers[0].instanceView.events"
   ```

### Debug Mode

The current image includes a 30-second sleep after crashes to capture logs.

---

## 📋 Files Modified

All fixes have been applied to:
- `Dockerfile` - Fixed GLIBC, added curl, added debug logging
- `.dockerignore` - Excludes .env file
- `.env` - Correct DATABASE_URL

---

## ✨ What Was Fixed

1. **GLIBC Compatibility**: Changed from `debian:bookworm-slim` (GLIBC 2.36) to `debian:trixie-slim` (GLIBC 2.39+)
2. **Missing curl**: Added `curl` package for HEALTHCHECK
3. **Log Capture**: Added 30s sleep delay to capture logs even on immediate crash
4. **Environment Security**: .env file excluded from Docker image via .dockerignore

---

## 📝 Next Steps

1. Deploy via Azure Portal (instructions above)
2. Test health endpoint
3. Verify logs show successful database connection
4. Test API endpoints
5. Update dashboard to use new Rust executor URL

---

Generated: 2025-10-12
Docker Image: mediarworkflowacr.azurecr.io/workflow-executor:dev-latest
