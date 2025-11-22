# UUID-Based Workflow Download - Deployment Notes

## Overview

Phase 1 & 2 implementation complete:
- Next.js download route with service token authentication
- Rust executor support for downloading workflows from GitHub releases
- UUID-based flat directory structure: `S:\{uuid}\`

## Database Migrations (Already Run)

All 4 migrations have been applied:
1. `20251122000001_add_workflow_uuid.sql` - Added UUID column
2. `20251122000002_add_uuid_to_org_access.sql` - Added UUID to org access functions
3. `20251122000003_add_download_functions.sql` - Added download metadata functions
4. `20251122000004_add_machine_service_token.sql` - Added service tokens to VMs

## Environment Variables

### Vercel (Next.js)

**Already Set:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GITHUB_WORKFLOW_TOKEN`
- `CLERK_SECRET_KEY`

**TODO - Set in Vercel Dashboard:**
```bash
MEDIAR_WEBHOOK_SECRET=8a413f4e4249dfd5d91285886a6839d0e9dac2b34a1c60d457cbd35e7ef202ea
```

### Remote Machines (VMs)

Set `MCP_SERVICE_TOKEN` on each active VM:

**Imperial Treasure infra v2 (ID: 22):**
```
95f204974c73b84045528147e6745f20b2c39b3b0639d16969279b1bfa5925b2
```

**Imperial treasure OneDrive to SAP (ID: 6):**
```
f20fd4169ea6fcfa42712026558ad5ddeea8cd7a3d21e2a376e2d4846ab9a5a3
```

**Public beta dev machine (ID: 21):**
```
2669a8847629fe461d21bac16facdd49887c98d3d29fd20fdbd2aa94c34099ba
```

## Testing Download Route

```bash
SERVICE_TOKEN="95f204974c73b84045528147e6745f20b2c39b3b0639d16969279b1bfa5925b2"
ORG_ID="org_2yydAO45WOB4RaCE4F4BNUPtw9c"
WORKFLOW_UUID="cd811d5c-e4ed-499a-8c35-5dc157acfc5e"

curl -v \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "X-Organization-ID: $ORG_ID" \
  https://app.mediar.ai/api/workflows/$WORKFLOW_UUID/download
```

**Expected:** 200 + ZIP (if workflow has github_release_url), 403 (no access), 404 (not found), or 401 (bad token)
