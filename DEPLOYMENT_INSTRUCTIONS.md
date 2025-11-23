# Deployment Instructions - Phase 1 & 2

## Active Machines (Need MCP_SERVICE_TOKEN)

Based on database query, these are the ACTIVE machines:

1. **ExampleClient infra v2** (ID: 22)
   - MCP: http://40.76.118.115:8080/mcp
   - Token: `95f204974c73b84045528147e6745f20b2c39b3b0639d16969279b1bfa5925b2`
   - Status: active

2. **ExampleClient OneDrive to SAP** (ID: 6)
   - MCP: http://13.77.110.245:8080/mcp
   - Token: `f20fd4169ea6fcfa42712026558ad5ddeea8cd7a3d21e2a376e2d4846ab9a5a3`
   - Status: active

3. **Public beta development machine** (ID: 21)
   - MCP: http://4.227.217.44:8080/mcp
   - Token: `2669a8847629fe461d21bac16facdd49887c98d3d29fd20fdbd2aa94c34099ba`
   - Status: active

---

## Step-by-Step Deployment

### 1. ✅ Database Migrations (DONE)
All 4 migrations have been run.

### 2. Deploy to Vercel

```bash
cd mediar-web-app

# Add all changes
git add supabase/migrations/
git add app/api/workflows/

# Commit
git commit -m "feat: UUID-based workflow downloads with service token auth

- Add UUID, github_release_url fields to deployed_workflows
- Add service_token to remote_machines for VM authentication
- Implement /api/workflows/[uuid]/download route (dual auth: Clerk + service token)
- Implement /api/workflows/[uuid]/webhook route for GitHub releases
- Support both user-triggered and scheduled workflow downloads"

# Push to deploy
git push origin main
```

Vercel will auto-deploy.

### 3. Set Vercel Environment Variables

In Vercel dashboard → Settings → Environment Variables:

**Add these NEW variables:**
- `MEDIAR_WEBHOOK_SECRET` = `<generate_random_string>`
  ```bash
  # Generate:
  openssl rand -hex 32
  ```

- `GITHUB_WORKFLOW_TOKEN` = `<github_pat>` (optional, for private repos)

**Redeploy** after adding env vars.

### 4. Set MCP_SERVICE_TOKEN on VMs

For each ACTIVE VM, set the service token:

**Option A: Via Azure CLI (recommended)**
```bash
# ExampleClient infra v2
az vm run-command invoke \
  --resource-group <rg_name> \
  --name <vm_name> \
  --command-id RunPowerShellScript \
  --scripts "setx MCP_SERVICE_TOKEN '95f204974c73b84045528147e6745f20b2c39b3b0639d16969279b1bfa5925b2' /M"

# ExampleClient OneDrive to SAP
az vm run-command invoke \
  --resource-group <rg_name> \
  --name <vm_name> \
  --command-id RunPowerShellScript \
  --scripts "setx MCP_SERVICE_TOKEN 'f20fd4169ea6fcfa42712026558ad5ddeea8cd7a3d21e2a376e2d4846ab9a5a3' /M"

# Public beta dev machine
az vm run-command invoke \
  --resource-group <rg_name> \
  --name <vm_name> \
  --command-id RunPowerShellScript \
  --scripts "setx MCP_SERVICE_TOKEN '2669a8847629fe461d21bac16facdd49887c98d3d29fd20fdbd2aa94c34099ba' /M"
```

**Option B: Via RDP**
1. RDP into each VM
2. Open PowerShell as Administrator
3. Run: `setx MCP_SERVICE_TOKEN "<token>" /M`
4. Restart any running executors

### 5. Update Packer Image (for new VMs)

Add to Packer provisioning script:
```powershell
# Retrieve service token from Azure Key Vault or pass as variable
$SERVICE_TOKEN = $env:MCP_SERVICE_TOKEN
if ($SERVICE_TOKEN) {
    setx MCP_SERVICE_TOKEN $SERVICE_TOKEN /M
    Write-Host "✅ MCP_SERVICE_TOKEN configured"
}
```

---

## Testing After Deployment

### Test 1: Download Route with Service Token

```bash
# Get an active machine's token
SERVICE_TOKEN="95f204974c73b84045528147e6745f20b2c39b3b0639d16969279b1bfa5925b2"

# Get a workflow UUID (create test workflow or use existing)
WORKFLOW_UUID="<from_database>"
ORG_ID="<from_database>"

# Test download
curl -v \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "X-Organization-ID: $ORG_ID" \
  https://app.mediar.ai/api/workflows/$WORKFLOW_UUID/download \
  -o test-download.zip

# Expected: 200 OK with zip file
# Headers should include: X-Auth-Method: service_token
```

### Test 2: Create Test Workflow with GitHub Release

```sql
-- Insert test workflow
INSERT INTO deployed_workflows (
  name,
  uuid,
  github_release_url,
  github_release_checksum,
  package_json_version,
  organization_id,
  preferred_format,
  status
) VALUES (
  'Test Download Workflow',
  gen_random_uuid(),
  'https://github.com/user/repo/releases/download/v1.0.0/workflow.zip',
  'abc123...',
  '1.0.0',
  'org_abc123',
  'typescript',
  'deployed'
);

-- Grant access to org
INSERT INTO workflow_organization_access (organization_id, workflow_uuid)
VALUES ('org_abc123', '<uuid_from_above>');
```

Then test download route with this workflow.

---

## Rollback Plan

If issues occur:

1. **Next.js routes:** Revert Vercel deployment in dashboard
2. **Database:** Migrations are additive, safe to leave
3. **VMs:** Remove `MCP_SERVICE_TOKEN` env var if needed

---

## Success Criteria

- [ ] Vercel deployment successful
- [ ] MEDIAR_WEBHOOK_SECRET set in Vercel
- [ ] Download route returns 200 with service token
- [ ] Download route returns 200 with Clerk session
- [ ] MCP_SERVICE_TOKEN set on all active VMs
- [ ] Test workflow downloads successfully

---

## Next Phase: Rust Executor

After Next.js routes are deployed and tested, we'll:
1. Build updated Rust executor
2. Deploy to production
3. Test end-to-end workflow execution with download
