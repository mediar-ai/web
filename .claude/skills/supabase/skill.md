---
name: supabase
description: Query Supabase database for Mediar workflow system. Auto-activates when user asks about database, tables, schema, workflows, executions, or organizations. Trigger words: "check database", "query supabase", "table schema", "show workflows", "check executions", "what's in the db", "database structure"
allowed-tools: Bash, Read
---

# Supabase Database Skill

Query and inspect the Mediar Supabase database for workflows, executions, organizations, and system data.

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
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

# Your query here
curl -s "${SUPABASE_URL}/rest/v1/workflows?select=id,name&limit=5" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
EOF
bash /tmp/query_supabase.sh
```

**Environment variables (loaded from `.env.development`):**
- `SUPABASE_URL` - API base URL
- `SUPABASE_SERVICE_KEY` - Service role key (bypasses RLS)

---

## Mediar Database Schema

### Core Tables

**`workflows`** - Workflow definitions
- `id` (number) - Primary key
- `name` (text) - Workflow name
- `description` (text) - Description
- `github_folder` (text) - Folder name in mediar-ai/workflows repo
- `yaml_content` (text) - Workflow YAML
- `organization_id` (number) - FK to organizations
- `created_at`, `updated_at` (timestamp)

**`workflow_executions`** - Execution records (⚠️ Note: table is `workflow_executions`, NOT `executions`)
- `id` (number) - Primary key
- `workflow_id` (number) - FK to workflows
- `workflow_version_id` (number) - FK to workflow_versions
- `status` (text) - running/completed/failed/queued
- `client_id` (text) - Client identifier (e.g., "cron-scheduler")
- `execution_params` (jsonb) - Input parameters
- `results` (jsonb) - Output results
- `error_message` (text) - Error if failed
- `queued_at`, `started_at`, `completed_at` (timestamp)
- `execution_duration_seconds` (number)
- `progress_percentage` (number) - 0-100
- `current_step_index` (number)
- `total_steps` (number)
- `assigned_machine_id` (number) - Executor machine
- `executor_type` (text) - python/rust
- `compute_cost_cents` (number) - Cost tracking
- `priority` (number) - 1-10 priority
- `modal_call_id` (text) - Modal execution ID
- `execution_logs`, `modal_logs`, `raw_logs` (text/jsonb)
- `screenshots` (jsonb array)
- `start_from_step`, `end_at_step` (text) - Partial execution control

**`organizations`** - Organization/tenant data
- `id` (number) - Primary key
- `name` (text) - Organization name
- `created_at`, `updated_at` (timestamp)

**`workflow_versions`** - Workflow version history
- `id` (number) - Primary key
- `workflow_id` (number) - FK to workflows
- `version_number` (text) - Version string (e.g., "1.0.1")
- `yaml_content` (text) - Workflow YAML snapshot
- `created_at` (timestamp)

---

## Common Queries

### 1. List All Workflows

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/workflows?select=id,name,github_folder,created_at&order=created_at.desc&limit=20" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) (\(.github_folder))"'
EOF
bash /tmp/query_supabase.sh
```

### 2. Get Workflow by ID

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

WORKFLOW_ID=153  # Replace with actual ID

curl -s "${SUPABASE_URL}/rest/v1/workflows?select=*&id=eq.${WORKFLOW_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
EOF
bash /tmp/query_supabase.sh
```

### 3. Search Workflows by Name

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

SEARCH_TERM="SAP"  # Replace with search term

curl -s "${SUPABASE_URL}/rest/v1/workflows?select=id,name,github_folder&name=ilike.*${SEARCH_TERM}*" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.'
EOF
bash /tmp/query_supabase.sh
```

### 4. Recent Executions

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,workflow_id,status,started_at,completed_at&order=started_at.desc&limit=10" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] Status: \(.status) | Workflow: \(.workflow_id) | Started: \(.started_at)"'
EOF
bash /tmp/query_supabase.sh
```

### 5. Failed Executions with Errors

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,workflow_id,error_message,started_at&status=eq.failed&order=started_at.desc&limit=5" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | {id, workflow_id, error: .error_message}'
EOF
bash /tmp/query_supabase.sh
```

### 6. Execution by ID with Workflow Details

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

EXECUTION_ID=20117  # Replace with actual ID

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=*,workflows(name,github_folder)&id=eq.${EXECUTION_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
EOF
bash /tmp/query_supabase.sh
```

### 7. Running Executions

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=id,workflow_id,progress_percentage,current_step_index,total_steps&status=eq.running&order=started_at.desc" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[] | "[\(.id)] \(.progress_percentage)% - Step \(.current_step_index)/\(.total_steps)"'
EOF
bash /tmp/query_supabase.sh
```

### 8. Execution Status Summary

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/workflow_executions?select=status" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq 'group_by(.status) | map({status: .[0].status, count: length})'
EOF
bash /tmp/query_supabase.sh
```

### 9. Organizations

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/organizations?select=id,name,created_at&order=name" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name)"'
EOF
bash /tmp/query_supabase.sh
```

### 10. Get Table Schema (Columns)

```bash
cat > /tmp/query_supabase.sh << 'EOF'
#!/bin/bash
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.development | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.development | cut -d '=' -f2 | tr -d '"')

TABLE_NAME="workflow_executions"  # Replace with table name

curl -s "${SUPABASE_URL}/rest/v1/${TABLE_NAME}?select=*&limit=1" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r 'if length > 0 then .[0] | keys[] else "Table empty or not found" end'
EOF
bash /tmp/query_supabase.sh
```

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

### Modifiers
- `select=col1,col2` - Select specific columns
- `select=*` - Select all columns
- `select=*,related_table(cols)` - Join related table
- `order=column.asc` - Sort ascending
- `order=column.desc` - Sort descending
- `limit=N` - Limit results
- `offset=N` - Skip N rows

### Headers
- `apikey: KEY` - API key (required)
- `Authorization: Bearer KEY` - Auth token (same as apikey)
- `Prefer: count=exact` - Include total count in response

---

## Output Formatting

### For Lists
```
## Workflows (showing 10 of 42)

[123] SAP Upload (sap-upload)
[124] Email Parser (email-parser)
[125] Data Sync (data-sync)
```

### For Detailed Records
```
## Execution #20117

- Workflow: [153] SAP Upload
- Status: running
- Progress: 45% (step 3/7)
- Started: 2025-11-07 17:35:40
- Client: cron-scheduler
- Machine: #21 (python executor)
```

### For Schema
```
## Table: workflow_executions

Columns (48 total):
- id, workflow_id, status, execution_params, results
- queued_at, started_at, completed_at
- progress_percentage, current_step_index, total_steps
- error_message, execution_logs, screenshots
- assigned_machine_id, executor_type
(see full schema in skill documentation)
```

---

## Error Handling

### Common Issues

**"relation does not exist"**
- Table name might be wrong
- Remember: Use `workflow_executions` NOT `executions`
- Check spelling: `workflows` not `workflow`

**"column does not exist"**
- Check column name in schema first
- Use query #10 to list all columns

**Empty result `[]`**
- Table might be empty
- Filter might be too restrictive
- Check filter syntax (e.g., `eq.VALUE` not `=VALUE`)

**Timeout/No response**
- Check network connection
- Verify `.env.development` has correct URL/key
- Try simpler query with `limit=1`

---

## Important Notes

1. **Table names:** `workflow_executions` (not `executions`), `workflows`, `organizations`
2. **Always use script pattern:** Avoids bash escaping issues
3. **Read-only by default:** Only do writes with user confirmation
4. **Service key:** Bypasses Row Level Security (RLS)
5. **JSON columns:** Use `jq` for parsing, `->` for nested access
6. **Large results:** Always use `limit` parameter
7. **Pagination:** Use `offset` + `limit` or check `Prefer: count=exact` header
8. **Joins:** Use `select=*,related_table(columns)` syntax
