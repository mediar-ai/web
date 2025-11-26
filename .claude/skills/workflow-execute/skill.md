---
name: workflow-execute
description: Execute Mediar workflows via API. Auto-activates when user says "run workflow", "execute workflow", "trigger workflow", "test workflow 314", or workflow IDs like "workflow 314". Supports passing parameters and checking execution status.
allowed-tools: Bash, Read
---

# Workflow Execution Skill

Execute Mediar workflows programmatically using the internal API with service role authentication.

## ⚠️ IMPORTANT NOTES

- Uses **cron-style authentication** (service role key + bypass token) to bypass Clerk auth
- Requires `SUPABASE_SERVICE_ROLE_KEY` and `VERCEL_AUTOMATION_BYPASS_SECRET` from `.env.local`
- Executions are **asynchronous** - use status endpoint to check completion
- **Secrets are auto-injected** by the executor from `org_secrets` table (see Secrets section below)

---

## Using Secrets (Dashboard-Stored Credentials)

Organization secrets are stored encrypted in the `org_secrets` table and **automatically injected by the executor** (both Python/Modal and Rust).

### Two Ways to Use Secrets:

**1. Placeholder Substitution** - Use `${SECRET_NAME}` syntax in parameter values:
```json
{
  "parameters": {
    "email": "${ONEDRIVE_EMAIL}",
    "password": "${ONEDRIVE_PASSWORD}",
    "totpSecret": "${ONEDRIVE_TOTP_SECRET}"
  }
}
```

**2. Auto-Injection** - Pass empty/minimal params and secrets are added automatically:
```json
{
  "parameters": {}
}
```
The executor adds ALL org secrets as top-level params (both `ONEDRIVE_EMAIL` and `onedrive_email` formats).

### Check Available Secrets:

```bash
cat > /tmp/list_secrets.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/org_secrets?select=name,description,org_id" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | {name, org_id}'
EOF
bash /tmp/list_secrets.sh
```

### Secrets for Workflow 314 (OneDrive Auth):
- `ONEDRIVE_EMAIL` - Microsoft account email
- `ONEDRIVE_PASSWORD` - Microsoft account password
- `ONEDRIVE_TOTP_SECRET` - TOTP secret for 2FA

---

## Quick Start - Execute a Workflow

**Use this pattern for triggering workflows:**

```bash
cat > /tmp/execute_workflow.sh << 'EOF'
#!/bin/bash
SERVICE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
BYPASS_TOKEN=$(grep "^VERCEL_AUTOMATION_BYPASS_SECRET=" .env.local | cut -d '=' -f2 | tr -d '"')

WORKFLOW_ID=314  # Change this
PARAMS='{"email": "test@example.com", "password": "test_pass", "totp_secret": "JBSWY3DPEHPK3PXP"}'

curl -s -X POST "https://app.mediar.ai/api/remote-workflows/${WORKFLOW_ID}/execute?x-vercel-protection-bypass=${BYPASS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "X-Cron-Execution: true" \
  -H "x-vercel-protection-bypass: ${BYPASS_TOKEN}" \
  -d "{\"parameters\": ${PARAMS}}" | jq '.'
EOF
bash /tmp/execute_workflow.sh
```

---

## API Reference

### Execute Workflow

**Endpoint:** `POST /api/remote-workflows/{workflowId}/execute`

**Headers (for service role auth):**
- `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`
- `X-Cron-Execution: true`
- `Content-Type: application/json`

**Query params:**
- `x-vercel-protection-bypass={VERCEL_AUTOMATION_BYPASS_SECRET}` - Required for cron auth

**Body:**
```json
{
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  },
  "executor_type": "python",  // or "rust"
  "machine_id": 18            // optional: specific machine ID
}
```

**Response:**
```json
{
  "success": true,
  "execution_id": 12345,
  "workflow_id": 314,
  "workflow_name": "OneDrive Authentication",
  "status": "queued",
  "message": "Workflow execution queued successfully..."
}
```

---

## Common Workflows

### OneDrive Authentication (ID: 314) - WITH SECRETS

**Recommended: Use dashboard secrets** (stored in org_secrets table):

```bash
cat > /tmp/execute_workflow.sh << 'EOF'
#!/bin/bash
SERVICE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
BYPASS_TOKEN=$(grep "^VERCEL_AUTOMATION_BYPASS_SECRET=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s -X POST "https://app.mediar.ai/api/remote-workflows/314/execute?x-vercel-protection-bypass=${BYPASS_TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "X-Cron-Execution: true" \
  -H "x-vercel-protection-bypass: ${BYPASS_TOKEN}" \
  -d '{
    "parameters": {
      "email": "${ONEDRIVE_EMAIL}",
      "password": "${ONEDRIVE_PASSWORD}",
      "totpSecret": "${ONEDRIVE_TOTP_SECRET}"
    },
    "executor_type": "rust"
  }' | jq '.'
EOF
bash /tmp/execute_workflow.sh
```

**Alternative: Hardcoded values** (for testing only):

```bash
curl -s -X POST "https://app.mediar.ai/api/remote-workflows/314/execute?..." \
  -d '{"parameters": {"email": "user@example.com", "password": "...", "totpSecret": "..."}}'
```

---

## Check Execution Status

```bash
cat > /tmp/check_status.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')

EXECUTION_ID=12345  # Change this

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,status,error_message,results,execution_logs&id=eq.${EXECUTION_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
EOF
bash /tmp/check_status.sh
```

---

## Get Workflow Schema (parameters)

```bash
cat > /tmp/get_schema.sh << 'EOF'
#!/bin/bash
WORKFLOW_ID=314  # Change this

curl -s "https://app.mediar.ai/api/remote-workflows/${WORKFLOW_ID}/schema" | jq '.schema'
EOF
bash /tmp/get_schema.sh
```

---

## List Available Workflows

```bash
cat > /tmp/list_workflows.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=id,name,version,status&status=eq.deployed&order=name" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) v\(.version)"'
EOF
bash /tmp/list_workflows.sh
```

---

## Poll Until Complete

```bash
cat > /tmp/poll_execution.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')

EXECUTION_ID=$1
if [ -z "$EXECUTION_ID" ]; then
  echo "Usage: bash /tmp/poll_execution.sh <execution_id>"
  exit 1
fi

echo "Polling execution $EXECUTION_ID..."
while true; do
  STATUS=$(curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=status&id=eq.${EXECUTION_ID}" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[0].status')

  echo "Status: $STATUS"

  if [ "$STATUS" = "completed" ] || [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,status,error_message,results&id=eq.${EXECUTION_ID}" \
      -H "apikey: ${SUPABASE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
    break
  fi

  sleep 5
done
EOF
# Usage: bash /tmp/poll_execution.sh 12345
```

---

## Environment Variables Required

From `.env.local`:
- `SUPABASE_URL` - Supabase API URL
- `SUPABASE_SERVICE_KEY` - Service role key (for database queries)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for API auth)
- `VERCEL_AUTOMATION_BYPASS_SECRET` - Bypass token for protected routes

---

## Troubleshooting

**405 Method Not Allowed / 404 Not Found**
- **CRITICAL**: Use `app.mediar.ai` NOT `www.mediar.ai`
- The `www.mediar.ai` domain has different Vercel protection settings
- Always include bypass token in BOTH query params AND header

**401 Unauthorized**
- Check `X-Cron-Execution: true` header
- Verify `SUPABASE_SERVICE_ROLE_KEY` is correct
- Ensure bypass token is in query params AND header

**403 Forbidden**
- Workflow may require specific organization access
- Check if machine is accessible to workflow's org

**400 Bad Request**
- Missing `parameters` key in body
- Invalid parameter types (check schema endpoint)

**503 Service Unavailable**
- No available machines for execution
- Check machine health status
