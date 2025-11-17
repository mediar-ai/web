---
name: clickhouse
description: Query ClickHouse for MCP server telemetry, logs, traces, and workflow metrics. Auto-activates when user asks about server logs, telemetry, traces, workflow performance, errors, or observability. Trigger words: "check logs", "query clickhouse", "mcp logs", "show traces", "workflow errors", "server telemetry", "check performance"
allowed-tools: Bash, Read
---

# ClickHouse MCP Telemetry Skill

Query and analyze MCP server OpenTelemetry data including logs, traces, workflow executions, and performance metrics.

## ⚠️ CRITICAL SAFETY RULES

**READ OPERATIONS (SELECT):** ✅ Safe to execute directly
**WRITE OPERATIONS (INSERT/UPDATE/DELETE):** ❌ **MUST ask user for explicit confirmation first**

For any modification:
1. Show exactly what will change (table, columns, values)
2. Ask: "This will modify ClickHouse. Confirm: yes/no?"
3. Only proceed if user explicitly confirms

---

## Quick Start - Copy-Paste Pattern

**Use this pattern for ALL queries to avoid bash escaping issues:**

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash

# Load credentials from .env.local (mediar-web-app) or .env.development
if [ -f .env.local ]; then
  CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local | cut -d '=' -f2 | tr -d '"')
  CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local | cut -d '=' -f2 | tr -d '"')
  CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local | cut -d '=' -f2 | tr -d '"')
  CH_DB=$(grep "^CLICKHOUSE_DATABASE=" .env.local | cut -d '=' -f2 | tr -d '"')
elif [ -f .env.development ]; then
  CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
  CH_USER=$(grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
  CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
  CH_DB=$(grep "^CLICKHOUSE_DATABASE=" .env.development | cut -d '=' -f2 | tr -d '"')
else
  echo "❌ ERROR: No .env.local or .env.development found!"
  echo ""
  echo "Please create .env.local with ClickHouse credentials:"
  echo "CLICKHOUSE_HOST=h4xqcq6igz.us-west-2.aws.clickhouse.cloud"
  echo "CLICKHOUSE_USER=default"
  echo "CLICKHOUSE_PASSWORD=<your-password>"
  echo "CLICKHOUSE_DATABASE=default"
  echo ""
  echo "To find your ClickHouse password:"
  echo "1. Go to https://clickhouse.cloud/"
  echo "2. Log in to your account"
  echo "3. Select your service (h4xqcq6igz)"
  echo "4. Go to 'Settings' → 'Security' → 'Database credentials'"
  echo "5. Copy the password or reset it"
  exit 1
fi

CH_URL="https://${CH_HOST}:8443"

# Your query here
QUERY="SELECT * FROM otel_traces WHERE Timestamp > now() - INTERVAL 1 HOUR LIMIT 10"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

**Environment variables (loaded from `.env.local` or `.env.development`):**
- `CLICKHOUSE_HOST` - ClickHouse host (e.g., `h4xqcq6igz.us-west-2.aws.clickhouse.cloud`)
- `CLICKHOUSE_USER` - Username (usually `default`)
- `CLICKHOUSE_PASSWORD` - Password/API key
- `CLICKHOUSE_DATABASE` - Database name (usually `default`)

**⚠️ If credentials are not found:**
1. The script will show an error with instructions
2. **To find your ClickHouse password/API key:**
   - Go to https://clickhouse.cloud/
   - Log in to your account
   - Select your service (e.g., `h4xqcq6igz`)
   - Navigate to **Settings → Security → Database credentials**
   - Copy the password or reset it if needed
3. Add the credentials to `.env.local` or `.env.development`

---

## MCP Telemetry Schema

### Core Tables

**`otel_traces`** - Workflow executions, tool calls, performance spans
- `Timestamp` (DateTime64(9)) - Nanosecond precision timestamp
- `TraceId` (String) - Unique trace identifier
- `SpanId` (String) - Unique span identifier
- `ParentSpanId` (String) - Parent span for hierarchy
- `SpanName` (LowCardinality(String)) - e.g., "execute_sequence", "step.click"
- `SpanKind` (LowCardinality(String)) - SERVER, INTERNAL, etc.
- `ServiceName` (LowCardinality(String)) - e.g., "terminator-mcp-agent"
- `ResourceAttributes` (Map(String, String)) - Host/service metadata
  - `ResourceAttributes['host.name']` - VM name (e.g., "mcp-fixed-otlp", "mcp-vm2")
  - `ResourceAttributes['service.name']` - Always "terminator-mcp-agent"
  - `ResourceAttributes['service.version']` - MCP agent version
- `SpanAttributes` (Map(String, String)) - Workflow/tool metadata
  - `SpanAttributes['workflow.name']` - Workflow identifier
  - `SpanAttributes['workflow.total_steps']` - Total steps in workflow
  - `SpanAttributes['tool.name']` - Tool being executed (e.g., "computer.screenshot")
  - `SpanAttributes['tool.duration_ms']` - Tool execution time
  - `SpanAttributes['tool.success']` - Boolean success flag
  - `SpanAttributes['error.message']` - Error description
  - `SpanAttributes['error.type']` - Classified error type (element_not_found, timeout, etc.)
  - `SpanAttributes['step.number']` - Current step number
  - `SpanAttributes['step.total']` - Total steps
- `Duration` (Int64) - Nanoseconds (divide by 1e9 for seconds)
- `StatusCode` (LowCardinality(String)) - STATUS_CODE_OK, STATUS_CODE_ERROR, Unset
- `StatusMessage` (String) - Error message if failed
- `Events.Timestamp` (Array(DateTime64(9))) - Event timestamps
- `Events.Name` (Array(LowCardinality(String))) - Event names
- `Events.Attributes` (Array(Map(String, String))) - Event attributes

**`otel_logs`** - Raw MCP server logs (⚠️ NOISY - includes HTTP client logs)

**`otel_logs_filtered`** - ✅ **USE THIS** - Filtered logs (excludes HTTP noise)
- `Timestamp` (DateTime64(9)) - Nanosecond precision timestamp
- `TraceId` (String) - Associated trace
- `SpanId` (String) - Associated span
- `SeverityText` (LowCardinality(String)) - DEBUG, INFO, WARN, ERROR
- `SeverityNumber` (Int32) - Numeric severity (0-24)
- `ServiceName` (LowCardinality(String)) - Service name
- `Body` (String) - Log message body
- `ResourceAttributes` (Map(String, String)) - Host/service metadata
  - `ResourceAttributes['host.name']` - VM name
- `ScopeName` (String) - Rust module name
- `LogAttributes` (Map(String, String)) - Log-specific attributes

**Data Flow:**
```
MCP Agent (terminator-mcp-agent)
  → OTLP Collector (port 4318)
  → ClickHouse Cloud (us-west-2)
```

---

## Common Queries

### 1. Recent Logs (Last Hour)

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT
  Timestamp,
  SeverityText,
  Body,
  ResourceAttributes['host.name'] as host,
  ScopeName
FROM otel_logs_filtered
WHERE Timestamp > now() - INTERVAL 1 HOUR
ORDER BY Timestamp DESC
LIMIT 50
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 2. Filter Logs by MCP Server

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

SERVER="mcp-vm2"  # Or: mcp-fixed-otlp, mcp-vm2, etc.

QUERY="
SELECT
  Timestamp,
  SeverityText,
  Body,
  ScopeName
FROM otel_logs_filtered
WHERE ResourceAttributes['host.name'] = '${SERVER}'
  AND Timestamp > now() - INTERVAL 1 HOUR
ORDER BY Timestamp DESC
LIMIT 50
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 3. Recent Workflow Executions

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT
  Timestamp,
  TraceId,
  Duration/1e9 as duration_seconds,
  StatusCode,
  SpanAttributes['workflow.name'] as workflow,
  SpanAttributes['workflow.total_steps'] as total_steps,
  ResourceAttributes['host.name'] as host
FROM otel_traces
WHERE SpanName = 'execute_sequence'
  AND Timestamp > now() - INTERVAL 24 HOUR
ORDER BY Timestamp DESC
LIMIT 20
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 4. Error Traces (Failed Workflows)

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT
  Timestamp,
  TraceId,
  SpanName,
  StatusMessage,
  SpanAttributes['error.message'] as error_message,
  SpanAttributes['error.type'] as error_type,
  SpanAttributes['workflow.name'] as workflow,
  ResourceAttributes['host.name'] as host
FROM otel_traces
WHERE StatusCode = 'STATUS_CODE_ERROR'
  AND Timestamp > now() - INTERVAL 24 HOUR
ORDER BY Timestamp DESC
LIMIT 20
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 5. Tool Usage Statistics (Last 24h)

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT
  if(mapContains(SpanAttributes, 'tool.name'),
    SpanAttributes['tool.name'],
    replaceRegexpOne(SpanName, '^step\\.', '')
  ) as tool,
  count() as executions,
  round(avg(Duration)/1e9, 3) as avg_seconds,
  round(max(Duration)/1e9, 3) as max_seconds,
  countIf(StatusCode = 'STATUS_CODE_ERROR') as failures,
  round((failures / executions) * 100, 2) as failure_rate
FROM otel_traces
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND (SpanName LIKE 'step.%' OR mapContains(SpanAttributes, 'tool.name'))
GROUP BY tool
HAVING tool != ''
ORDER BY executions DESC
LIMIT 30
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 6. MCP Server Health Overview

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT
  ResourceAttributes['host.name'] as server,
  count() as total_traces,
  countIf(StatusCode = 'STATUS_CODE_ERROR') as errors,
  round((errors / total_traces) * 100, 2) as error_rate,
  round(avg(Duration)/1e9, 3) as avg_duration_seconds,
  max(Timestamp) as last_seen
FROM otel_traces
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND mapContains(ResourceAttributes, 'host.name')
GROUP BY server
ORDER BY total_traces DESC
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 7. Get All Spans for a Trace (Debug Workflow)

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

TRACE_ID="your-trace-id-here"  # Replace with actual TraceId

QUERY="
SELECT
  Timestamp,
  SpanId,
  ParentSpanId,
  SpanName,
  Duration/1e9 as duration_seconds,
  StatusCode,
  SpanAttributes
FROM otel_traces
WHERE TraceId = '${TRACE_ID}'
ORDER BY Timestamp
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 8. Get Logs for a Trace

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

TRACE_ID="your-trace-id-here"  # Replace with actual TraceId

QUERY="
SELECT
  Timestamp,
  SeverityText,
  Body,
  ScopeName,
  LogAttributes
FROM otel_logs_filtered
WHERE TraceId = '${TRACE_ID}'
ORDER BY Timestamp
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 9. Error Logs Only (Last Hour)

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT
  Timestamp,
  Body,
  ResourceAttributes['host.name'] as host,
  ScopeName,
  TraceId
FROM otel_logs_filtered
WHERE SeverityText IN ('ERROR', 'FATAL')
  AND Timestamp > now() - INTERVAL 1 HOUR
ORDER BY Timestamp DESC
LIMIT 50
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

### 10. List All MCP Servers

```bash
cat > /tmp/query_clickhouse.sh << 'EOF'
#!/bin/bash
# Load credentials from .env
CH_HOST=$(grep "^CLICKHOUSE_HOST=" .env.local 2>/dev/null || grep "^CLICKHOUSE_HOST=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_USER=$(grep "^CLICKHOUSE_USER=" .env.local 2>/dev/null || grep "^CLICKHOUSE_USER=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_PASS=$(grep "^CLICKHOUSE_PASSWORD=" .env.local 2>/dev/null || grep "^CLICKHOUSE_PASSWORD=" .env.development | cut -d '=' -f2 | tr -d '"')
CH_URL="https://${CH_HOST}:8443"

QUERY="
SELECT DISTINCT
  ResourceAttributes['host.name'] as server,
  count() as trace_count,
  max(Timestamp) as last_seen
FROM otel_traces
WHERE mapContains(ResourceAttributes, 'host.name')
GROUP BY server
ORDER BY trace_count DESC
"

curl -u "${CH_USER}:${CH_PASS}" -s \
  -H "Content-Type: text/plain" \
  -d "${QUERY} FORMAT JSONEachRow" \
  "${CH_URL}" | jq -s '.'
EOF
bash /tmp/query_clickhouse.sh
```

---

## ClickHouse SQL Syntax Reference

### Time Ranges
```sql
-- Last hour
WHERE Timestamp > now() - INTERVAL 1 HOUR

-- Last 24 hours
WHERE Timestamp > now() - INTERVAL 24 HOUR

-- Last 7 days
WHERE Timestamp > now() - INTERVAL 7 DAY

-- Specific date range
WHERE Timestamp BETWEEN '2025-11-17 00:00:00' AND '2025-11-17 23:59:59'

-- Today only
WHERE toDate(Timestamp) = today()
```

### Map Attributes Access
```sql
-- Check if key exists
mapContains(SpanAttributes, 'workflow.name')

-- Get value (returns empty string if missing)
SpanAttributes['workflow.name']

-- Get value with default
if(mapContains(SpanAttributes, 'workflow.name'),
   SpanAttributes['workflow.name'],
   'unknown')

-- Convert to string (needed for some operations)
toString(SpanAttributes['workflow.name'])
```

### Filters
```sql
-- String equality
WHERE ResourceAttributes['host.name'] = 'mcp-vm2'

-- String contains (case-insensitive)
WHERE lower(Body) LIKE '%error%'

-- String regex
WHERE match(SpanName, '^step\\.')

-- IN clause
WHERE StatusCode IN ('STATUS_CODE_ERROR', 'Error')

-- NULL checks
WHERE StatusMessage != ''
WHERE mapContains(SpanAttributes, 'error.message')
```

### Aggregations
```sql
-- Count
SELECT count() FROM otel_traces

-- Average duration
SELECT avg(Duration)/1e9 as avg_seconds FROM otel_traces

-- Group by
SELECT
  ResourceAttributes['host.name'] as host,
  count() as total
FROM otel_traces
GROUP BY host

-- Conditional count
SELECT countIf(StatusCode = 'STATUS_CODE_ERROR') as errors
FROM otel_traces
```

### Output Formats
```sql
-- JSON array (single object with "data" field)
FORMAT JSON

-- JSON each row (NDJSON - one JSON object per line) - RECOMMENDED
FORMAT JSONEachRow

-- Pretty table (for humans)
FORMAT Pretty

-- CSV
FORMAT CSV

-- Tab-separated
FORMAT TabSeparated
```

---

## Output Formatting

### For Recent Logs
```
## Recent Logs (Last Hour)

[2025-11-17 22:16:36] [INFO] [mcp-vm2] Using terminator.js version 0.23.5
[2025-11-17 22:16:35] [INFO] [mcp-vm2] Found executable: C:\Program Files\nodejs\node.exe
[2025-11-17 22:16:34] [ERROR] [mcp-fixed-otlp] Failed to find element: button#submit
```

### For Workflow Executions
```
## Recent Workflow Executions

TraceId: abc123...
- Workflow: execute_sequence
- Status: STATUS_CODE_OK
- Duration: 3.45 seconds
- Host: mcp-vm2
- Steps: 5

TraceId: def456...
- Workflow: execute_sequence
- Status: STATUS_CODE_ERROR
- Duration: 307.04 seconds
- Host: mcp-vm2
- Error: npm install timed out
```

### For Server Health
```
## MCP Server Health (Last 24h)

mcp-fixed-otlp:
- Total traces: 11,358
- Errors: 234 (2.06%)
- Avg duration: 1.23s
- Last seen: 2025-11-07 01:43:18

mcp-vm2:
- Total traces: 5,540
- Errors: 98 (1.77%)
- Avg duration: 2.45s
- Last seen: 2025-11-07 19:08:31
```

---

## Error Handling

### Common Issues

**"Code: 60. DB::Exception: Table default.otel_traces doesn't exist"**
- Table might not exist yet
- Check OTLP collector is running and sending data
- Verify ClickHouse connection: `SELECT 1 FORMAT JSON`

**Empty result with no errors**
- No data in time range (try wider range: `INTERVAL 7 DAY`)
- Check when last data was received: `SELECT max(Timestamp) FROM otel_traces`
- Filter too restrictive (check host name matches exactly)

**"Code: 47. DB::Exception: Unknown identifier: workflow.name"**
- Missing quotes around map keys
- Use: `SpanAttributes['workflow.name']` not `SpanAttributes[workflow.name]`

**Timeout/Slow query**
- Always include time range filter on `Timestamp`
- Use `LIMIT` to cap result size
- Avoid `SELECT *` on large tables (use specific columns)

**Connection refused / 401 Unauthorized**
- Check credentials (username/password)
- Verify URL is correct (port 8443 for HTTPS)
- Try: `curl -u default:oi~mx3yL8UOgh https://h4xqcq6igz.us-west-2.aws.clickhouse.cloud:8443 -d "SELECT 1"`

---

## Important Notes

1. **Preferred table:** Use `otel_logs_filtered` NOT `otel_logs` (291M fewer noisy HTTP logs)
2. **Always filter by time:** Include `WHERE Timestamp > now() - INTERVAL ...` for performance
3. **Map syntax:** Access attributes with `SpanAttributes['key']` or check first with `mapContains()`
4. **Duration conversion:** Divide by `1e9` to convert nanoseconds to seconds
5. **Read-only by default:** Only modify data with user confirmation
6. **Output format:** Use `FORMAT JSONEachRow` for easy parsing with `jq`
7. **Large results:** Always use `LIMIT` parameter
8. **Known MCP servers:** mcp-fixed-otlp, mcp-vm2, mcp-debug-v16, mcp-test-vm
9. **Trace hierarchy:** Use `ParentSpanId` to reconstruct workflow execution tree
10. **Error classification:** Check `SpanAttributes['error.type']` for categorized errors

---

## MCP Agent Error Types

Common error types in `SpanAttributes['error.type']`:
- `element_not_found` - UI element not found
- `timeout` - Operation timeout
- `permission_denied` - Access denied
- `network_error` - Network/connection issues
- `validation_error` - Invalid input
- `other` - Unclassified errors

---

## Advanced Examples

### Find Slowest Workflows
```sql
SELECT
  SpanAttributes['workflow.name'] as workflow,
  ResourceAttributes['host.name'] as host,
  Duration/1e9 as seconds,
  Timestamp
FROM otel_traces
WHERE SpanName = 'execute_sequence'
  AND Timestamp > now() - INTERVAL 7 DAY
ORDER BY Duration DESC
LIMIT 10
```

### Error Rate by Tool
```sql
SELECT
  replaceRegexpOne(SpanName, '^step\\.', '') as tool,
  count() as total,
  countIf(StatusCode = 'STATUS_CODE_ERROR') as errors,
  round((errors / total) * 100, 2) as error_rate
FROM otel_traces
WHERE SpanName LIKE 'step.%'
  AND Timestamp > now() - INTERVAL 7 DAY
GROUP BY tool
HAVING total >= 10
ORDER BY error_rate DESC
```

### Logs with Context (join trace data)
```sql
SELECT
  l.Timestamp,
  l.Body,
  l.SeverityText,
  t.SpanName,
  t.SpanAttributes['workflow.name'] as workflow
FROM otel_logs_filtered l
LEFT JOIN otel_traces t ON l.TraceId = t.TraceId AND l.SpanId = t.SpanId
WHERE l.Timestamp > now() - INTERVAL 1 HOUR
  AND l.SeverityText = 'ERROR'
ORDER BY l.Timestamp DESC
LIMIT 20
```
