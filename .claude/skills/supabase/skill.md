---
name: supabase
description: Query Supabase database for Mediar workflow system. Auto-activates when user asks about database, tables, schema, workflows, executions, machines, or organizations. Trigger words: "check database", "query supabase", "table schema", "show workflows", "check executions", "what's in the db", "database structure", "remote machines"
allowed-tools: Bash, Read
---

# Supabase Database Skill

Query and inspect the Mediar Supabase database for workflows, executions, remote machines, and system data.

## ⚠️ CRITICAL SAFETY RULES

**READ OPERATIONS (GET/SELECT):** ✅ Safe to execute directly
**WRITE OPERATIONS (POST/PATCH/DELETE):** ❌ **MUST ask user for explicit confirmation first**

For any modification:
1. Show exactly what will change (table, columns, values)
2. Ask: "This will modify the database. Confirm: yes/no?"
3. Only proceed if user explicitly confirms

---

## Quick Start - Copy-Paste Pattern

**Use this pattern for ALL queries to avoid bash escaping issues:**

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

# Your query here
curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=id,name&limit=5" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
SCRIPT
bash /tmp/query_supabase.sh
```

**Environment variables (loaded from `.env.local`):**
- `SUPABASE_URL` - API base URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (bypasses RLS)

---

## Mediar Database Schema

### Core Tables (✅ = Confirmed to exist)

**✅ `deployed_workflows`** - Workflow definitions (NOT `workflows`)
- `id` (number) - Primary key
- `name` (text) - Workflow name
- `description` (text) - Description
- `github_folder` (text) - Folder name in mediar-ai/workflows repo
- `github_path` (text) - Full GitHub path
- `github_sha` (text) - Git commit SHA
- `github_sync_status` (text) - Sync status
- `github_last_synced_at` (timestamp)
- `automation_sequence` (text) - Legacy YAML content
- `automation_sequence_yaml` (text) - Workflow YAML
- `preferred_format` (text) - "yaml" or "typescript"
- `workflow_type` (text) - Type of workflow
- `organization_id` (number) - FK to organizations (via Clerk)
- `current_version_id` (number) - Current active version
- `version` (text) - Version string
- `total_versions` (number) - Count of versions
- `status` (text) - active/paused/archived
- `category` (text) - Workflow category
- `cron_enabled` (boolean) - Scheduled execution enabled
- `cron_expression` (text) - Cron schedule
- `cron_timezone` (text) - Timezone for cron
- `cron_retry_on_failure` (boolean)
- `cron_retry_count` (number)
- `cron_max_concurrent` (number)
- `cron_auto_paused` (boolean)
- `auto_pause_reason`, `auto_paused_at`
- `requires_files` (boolean) - Has associated files
- `files_config` (jsonb) - File metadata
- `typescript_metadata` (jsonb) - TS workflow metadata
- `total_executions`, `successful_runs`, `failed_runs`, `cancelled_runs` (number)
- `average_duration_seconds`, `estimated_duration_seconds` (number)
- `current_version_*` - Stats for current version
- `consecutive_failures` (number)
- `last_successful_execution`, `last_failed_execution`, `last_failure_message`
- `next_scheduled_execution`, `last_scheduled_execution` (timestamp)
- `display_order` (number)
- `is_public` (boolean)
- `parent_workflow_id` (number) - For nested workflows
- `skip_next_cancellation_check` (boolean)
- `created_at`, `updated_at`, `created_by` (timestamp/text)

**✅ `workflow_executions`** - Execution records
- `id` (number) - Primary key
- `workflow_id` (number) - FK to deployed_workflows
- `workflow_version_id` (number) - Specific version executed
- `workflow_version_number` (text) - Version string
- `version_number` (text) - Legacy version field
- `status` (text) - queued/running/completed/failed/cancelled
- `client_id` (text) - Client identifier (e.g., "cron-scheduler", "web-ui")
- `client_ip` (text) - Client IP address
- `user_agent` (text) - User agent string
- `batch_id` (text) - For batch executions
- `execution_params` (jsonb) - Input parameters
- `execution_params_hash` (text) - Hash of params for deduplication
- `results` (jsonb) - Output results
- `formatted_output` (text) - Human-readable output
- `error_message` (text) - Error if failed
- `error_analysis` (text) - AI-analyzed error
- `error_analyzed_at` (timestamp)
- `queued_at`, `started_at`, `completed_at` (timestamp)
- `step_start_time` (timestamp) - Current step start
- `execution_duration_seconds` (number)
- `estimated_completion_time` (timestamp)
- `progress_percentage` (number) - 0-100
- `progress_details` (text)
- `current_step_index` (number)
- `current_step_description` (text)
- `total_steps` (number)
- `start_from_step`, `end_at_step` (text) - Partial execution
- `execute_jumps_at_end` (boolean)
- `follow_fallback` (boolean)
- `assigned_machine_id` (number) - FK to remote_machines
- `assignment_method`, `assignment_reason` (text)
- `machine_assignment_timestamp` (timestamp)
- `mcp_endpoint` (text) - Direct MCP URL if not using machine
- `executor_type` (text) - "python" or "rust"
- `compute_cost_cents` (number) - Cost tracking
- `priority` (number) - 1-10 priority
- `modal_call_id` (text) - Modal function call ID
- `execution_logs` (text) - Structured logs
- `modal_logs` (text) - Modal-specific logs
- `raw_logs` (text) - Raw unprocessed logs
- `raw_mcp_response` (jsonb) - Raw MCP tool response
- `screenshots` (jsonb array) - Base64 screenshots
- `created_at`, `updated_at` (timestamp)

**✅ `remote_machines`** - MCP-enabled execution machines
- `id` (number) - Primary key
- `name` (text) - Machine display name
- `description` (text) - Machine description
- `mcp_endpoint` (text) - MCP server URL (e.g., http://IP:8080/mcp)
- `health_endpoint` (text) - Health check URL
- `management_endpoint` (text) - Management API URL
- `azure_resource_id` (text) - Full Azure resource ID
- `guacamole_connection_name` (text) - RDP connection name
- `machine_type` (text) - "windows_vm", "linux_vm", "container"
- `status` (text) - "active", "inactive", "maintenance", "error"
- `health_status` (text) - "healthy", "unhealthy", "unknown"
- `health_details` (jsonb) - Detailed health info
- `region` (text) - Azure region
- `capabilities` (jsonb array) - Machine capabilities
- `tags` (jsonb array) - Searchable tags
- `priority` (number) - Assignment priority
- `max_concurrent_executions` (number)
- `is_global` (boolean) - Available to all orgs
- `last_health_check`, `last_healthy_at`, `last_unhealthy_at` (timestamp)
- `last_response_time_ms` (number)
- `avg_response_time_ms` (number)
- `last_check_had_taskbar` (boolean) - Windows UI check
- `total_executions` (number)
- `total_checks`, `successful_checks`, `consecutive_failures` (number)
- `success_rate_percent` (number)
- `uptime_percentage` (number)
- `avg_execution_time_seconds` (number)
- `created_at`, `updated_at`, `created_by` (timestamp/text)

**✅ `users`** - User accounts (legacy, may not have all users)
- `id` (uuid) - Primary key
- `clerk_id` (text) - Clerk user ID
- `email` (text) - User email
- `credits` (number) - Legacy credits column (use `user_credits` table instead)
- `stripe_connected` (boolean) - Stripe integration status
- `created_at` (timestamp)

**✅ `mediar_users`** - Clerk user mapping (USE THIS to find users by email)
- `user_id` (text) - Clerk user ID (e.g., "user_36fQPkr6PENlNKo8yhJffGZ3gzh")
- `name` (text) - User display name
- `email` (text) - User email
- `organization_id` (text) - Clerk organization ID
- `created_at` (timestamp)

**✅ `user_credits`** - User credit balances (NEW credit system)
- `id` (uuid) - Primary key
- `user_id` (text) - Clerk user ID (NOT email!)
- `balance` (integer) - Current credit balance
- `lifetime_earned` (integer) - Total credits ever earned
- `lifetime_spent` (integer) - Total credits ever spent
- `created_at` (timestamp)
- `updated_at` (timestamp)

**✅ `credit_transactions`** - Credit audit trail
- `id` (uuid) - Primary key
- `user_id` (text) - Clerk user ID
- `amount` (integer) - +positive for credits, -negative for debits
- `type` (text) - 'purchase', 'vm_launch', 'vm_usage', 'refund', 'bonus', 'onboarding', 'manual'
- `description` (text) - Human-readable description
- `reference_id` (text) - Stripe session ID, machine ID, etc.
- `balance_after` (integer) - Balance after transaction
- `created_at` (timestamp)

**❌ `workflows`** - DOES NOT EXIST (use `deployed_workflows` instead)
**❌ `workflow_versions`** - DOES NOT EXIST  
**❌ `organizations`** - DOES NOT EXIST (use Clerk org IDs in `deployed_workflows.organization_id`)
**❌ `workflow_schedules`** - DOES NOT EXIST (schedules are in `deployed_workflows.cron_*` columns)
**❌ `api_keys`** - DOES NOT EXIST

---

## Common Queries

### 1. List All Workflows

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=id,name,github_folder,status,total_executions&order=created_at.desc&limit=20" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) - \(.total_executions) runs (\(.status))"'
SCRIPT
bash /tmp/query_supabase.sh
```

### 2. Get Workflow by ID

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

WORKFLOW_ID=239  # Replace with actual ID

curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=*&id=eq.${WORKFLOW_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
SCRIPT
bash /tmp/query_supabase.sh
```

### 3. Search Workflows by Name

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

SEARCH_TERM="onedrive"  # Replace with search term

curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=id,name,github_folder&name=ilike.*${SEARCH_TERM}*" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
SCRIPT
bash /tmp/query_supabase.sh
```

### 4. Recent Executions

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,workflow_id,status,started_at,completed_at,executor_type&order=started_at.desc&limit=10" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.status) | Workflow \(.workflow_id) | \(.executor_type) | \(.started_at)"'
SCRIPT
bash /tmp/query_supabase.sh
```

### 5. Failed Executions with Errors

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,workflow_id,error_message,started_at&status=eq.failed&order=started_at.desc&limit=5" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | {id, workflow_id, error: .error_message}'
SCRIPT
bash /tmp/query_supabase.sh
```

### 6. List All Remote Machines

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,status,health_status,machine_type,total_executions&order=name" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) - \(.status)/\(.health_status) - \(.total_executions) runs"'
SCRIPT
bash /tmp/query_supabase.sh
```

### 7. Get Machine by ID or Name

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

MACHINE_ID=18  # Replace with ID or use name filter

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=*&id=eq.${MACHINE_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
SCRIPT
bash /tmp/query_supabase.sh
```

### 8. Running Executions

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,workflow_id,progress_percentage,current_step_index,total_steps,assigned_machine_id&status=eq.running&order=started_at.desc" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | "[\(.id)] \(.progress_percentage)% - Step \(.current_step_index)/\(.total_steps) - Machine #\(.assigned_machine_id)"'
SCRIPT
bash /tmp/query_supabase.sh
```

### 9. Execution Status Summary

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=status" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq 'group_by(.status) | map({status: .[0].status, count: length})'
SCRIPT
bash /tmp/query_supabase.sh
```

### 10. Get Table Schema (Columns)

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

TABLE_NAME="workflow_executions"  # Replace: deployed_workflows, remote_machines, users

curl -s "${SUPABASE_URL}/rest/v1/${TABLE_NAME}?select=*&limit=1" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r 'if length > 0 then .[0] | keys | sort | join(", ") else "Table empty or not found" end'
SCRIPT
bash /tmp/query_supabase.sh
```

### 11. Scheduled Workflows (Cron-Enabled)

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=id,name,cron_expression,cron_timezone,next_scheduled_execution&cron_enabled=eq.true&order=next_scheduled_execution" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) - \(.cron_expression) (\(.cron_timezone)) - Next: \(.next_scheduled_execution)"'
SCRIPT
bash /tmp/query_supabase.sh
```

### 12. TypeScript Workflows

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/deployed_workflows?select=id,name,github_folder,requires_files&preferred_format=eq.typescript&order=name" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) - Files: \(.requires_files)"'
SCRIPT
bash /tmp/query_supabase.sh
```

---

## Credit System Queries

### 13. Find User by Email (to get Clerk ID)

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

EMAIL="user@example.com"  # Replace with email to search

curl -s "${SUPABASE_URL}/rest/v1/mediar_users?select=*&email=ilike.*${EMAIL}*" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
SCRIPT
bash /tmp/query_supabase.sh
```

### 14. Check User Credits

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

USER_ID="user_xxxxx"  # Replace with Clerk user ID

curl -s "${SUPABASE_URL}/rest/v1/user_credits?select=*&user_id=eq.${USER_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
SCRIPT
bash /tmp/query_supabase.sh
```

### 15. Add Credits to User (uses RPC function)

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

USER_ID="user_xxxxx"  # Replace with Clerk user ID
AMOUNT=100            # Credits to add

curl -s "${SUPABASE_URL}/rest/v1/rpc/add_credits" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"p_user_id\": \"${USER_ID}\",
    \"p_amount\": ${AMOUNT},
    \"p_type\": \"manual\",
    \"p_description\": \"Manual top-up by admin\"
  }" | jq '.'
SCRIPT
bash /tmp/query_supabase.sh
```

### 16. View Credit Transactions for User

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

USER_ID="user_xxxxx"  # Replace with Clerk user ID

curl -s "${SUPABASE_URL}/rest/v1/credit_transactions?select=*&user_id=eq.${USER_ID}&order=created_at.desc&limit=20" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | {type, amount, description, balance_after, created_at}'
SCRIPT
bash /tmp/query_supabase.sh
```

### 17. List All Users with Credits

```bash
cat > /tmp/query_supabase.sh << 'SCRIPT'
#!/bin/bash
cd /c/Users/louis030195/Documents/mediar-web-app
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"' | tr -d '\n' | tr -d '\\')

curl -s "${SUPABASE_URL}/rest/v1/user_credits?select=*&order=balance.desc" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | {user_id, balance, lifetime_earned, lifetime_spent}'
SCRIPT
bash /tmp/query_supabase.sh
```

---

## RPC Functions

The credit system uses these PostgreSQL functions:

- **`add_credits(p_user_id, p_amount, p_type, p_description, p_reference_id)`** - Add credits (creates user record if doesn't exist)
- **`deduct_credits(p_user_id, p_amount, p_type, p_description, p_reference_id)`** - Deduct credits with validation
- **`get_user_credits(p_user_id)`** - Get current balance

---

## PostgREST Query Syntax

### Filters
- `eq.VALUE` - equals
- `neq.VALUE` - not equals
- `gt.VALUE` - greater than
- `gte.VALUE` - greater than or equal
- `lt.VALUE` - less than
- `lte.VALUE` - less than or equal
- `like.*PATTERN*` - LIKE (case-sensitive)
- `ilike.*PATTERN*` - LIKE (case-insensitive)
- `is.null` - IS NULL
- `not.is.null` - IS NOT NULL
- `in.(val1,val2,val3)` - IN
- `or=(filter1,filter2)` - OR condition

### Modifiers
- `select=col1,col2` - Select specific columns
- `select=*` - Select all columns
- `order=column.asc` - Sort ascending
- `order=column.desc` - Sort descending
- `limit=N` - Limit results
- `offset=N` - Skip N rows

### Headers
- `apikey: KEY` - API key (required)
- `Authorization: Bearer KEY` - Auth token (same as apikey)
- `Prefer: count=exact` - Include total count in response

---

## Error Handling

### Common Issues

**"relation does not exist"**
- Use `deployed_workflows` NOT `workflows`
- Use `remote_machines` NOT `machines`
- Check table name spelling

**"column does not exist"**
- Check schema with query #10
- Common mistakes: `ip_address` doesn't exist (use `mcp_endpoint`)

**Empty result `[]`**
- Table might be empty
- Filter might be too restrictive
- Check filter syntax (e.g., `eq.VALUE` not `=VALUE`)

**Timeout/No response**
- Check `.env.development` has correct URL/key
- Try simpler query with `limit=1`

---

## Important Notes

1. **Correct table names:** `deployed_workflows`, `workflow_executions`, `remote_machines`, `mediar_users`, `user_credits`, `credit_transactions`
2. **Always use script pattern:** Avoids bash escaping issues
3. **No organizations table:** Use `organization_id` in workflows (Clerk IDs)
4. **No workflow_versions table:** Version tracking is embedded in `deployed_workflows`
5. **Service key:** Bypasses Row Level Security (RLS)
6. **JSON columns:** Use `jq` for parsing
7. **Large results:** Always use `limit` parameter
8. **Finding users by email:** Use `mediar_users` table, NOT `users` table
9. **Credits:** Use `user_credits` table and RPC functions (`add_credits`, `deduct_credits`)
10. **Clerk user IDs:** Look like `user_36fQPkr6PENlNKo8yhJffGZ3gzh` - required for credit operations
11. **Env file:** Use `.env.local` with `SUPABASE_SERVICE_ROLE_KEY` (not `.env.development`)
