# End-to-End Telemetry Testing Guide

## Overview
This guide walks through testing the complete telemetry pipeline: Vector → Supabase → Dashboard

## Prerequisites

1. **Supabase Tables Created**
   - Run the SQL script `supabase_telemetry_tables.sql` in Supabase SQL editor
   - Verify tables: `telemetry_traces`, `telemetry_metrics`, `telemetry_logs`

2. **Environment Variables**
   - Get your Supabase URL and keys from project settings
   - Service role key (for writing) and anon key (for reading)

## Step 1: Deploy Azure VMs with Vector

```bash
# Set Terraform variables
cd agents/avd-terraform
export TF_VAR_supabase_url="https://eshwntsgsputksqamckh.supabase.co"
export TF_VAR_supabase_anon_key="your-anon-key-here"

# Deploy the cluster
terraform apply
```

The VMs will:
- Install MCP agent
- Install Vector as Windows service
- Start collecting metrics, logs, and traces
- Send data to Supabase every 10 seconds

## Step 2: Verify Vector is Running

RDP into a VM and check:

```powershell
# Check Vector service
Get-Service VectorTelemetry

# Check Vector logs
Get-Content C:\vector\vector.log -Tail 50

# Test Vector health
curl http://localhost:8686/health
```

## Step 3: Verify Data in Supabase

Run these queries in Supabase SQL editor:

```sql
-- Check if traces are arriving
SELECT COUNT(*), MAX(created_at) as latest 
FROM telemetry_traces;

-- Check metrics
SELECT COUNT(*), MAX(created_at) as latest 
FROM telemetry_metrics;

-- Check logs
SELECT COUNT(*), MAX(created_at) as latest 
FROM telemetry_logs;

-- View recent traces
SELECT * FROM telemetry_trace_summaries 
LIMIT 10;
```

## Step 4: Test Dashboard

1. **Start the Next.js app:**
```bash
cd browser-workflow-capture-app
npm run dev
```

2. **Navigate to dashboard:**
```
http://localhost:3000/internal/dashboard
```

3. **Check each tab:**
   - **VM Status**: Should show VMs with health status
   - **Live Logs**: Stream logs from Vector (via Supabase)
   - **OpenTelemetry Traces**: Should show workflow traces from Supabase
   - **Rollback Console**: Failed workflows for manual intervention

## Step 5: Generate Test Data

### A. Run a test workflow to generate traces:

```bash
# From your local machine
curl -X POST http://172.203.20.145:8080/execute_sequence \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      {"tool_name": "take_screenshot", "arguments": {}},
      {"tool_name": "get_window_tree", "arguments": {"pid": 0}}
    ]
  }'
```

### B. Generate metrics by stressing CPU:

```powershell
# On the VM
while ($true) { 
  $result = 1..1000000 | ForEach-Object { [Math]::Sqrt($_) }
  Start-Sleep -Seconds 1
}
```

### C. Generate logs:

```powershell
# Write to MCP log location
"[ERROR] Test error message" | Out-File -Append C:\mcp-agent\logs\test.log
"[INFO] Workflow started" | Out-File -Append C:\mcp-agent\logs\test.log
```

## Step 6: Verify Full Pipeline

1. **Check Vector is shipping data:**
   - Vector logs should show successful HTTP POST to Supabase
   - No authentication errors

2. **Check Supabase is receiving:**
   - Row counts increasing
   - Recent timestamps updating

3. **Check Dashboard displays:**
   - Traces appearing with correct span hierarchy
   - Metrics showing CPU/memory usage
   - Logs appearing in real-time

## Troubleshooting

### Vector Not Sending Data
```powershell
# Check Vector config
Get-Content C:\vector\vector.toml

# Restart Vector
Restart-Service VectorTelemetry

# Check firewall
Get-NetFirewallRule | Where DisplayName -like "*Vector*"
```

### Supabase Not Receiving
- Check API keys are correct
- Verify RLS policies allow writes
- Check Supabase logs for errors

### Dashboard Not Showing Data
- Check browser console for errors
- Verify environment variables are set
- Check network tab for failed API calls

### Enable Debug Logging

In Vector config:
```toml
[sinks.console_debug]
type = "console"
inputs = ["*"]
encoding.codec = "json"
```

## Performance Considerations

- Vector batches data (100 events or 10 seconds)
- Supabase has rate limits (check your plan)
- Dashboard polls every 5 seconds
- Old data is cleaned up after 7 days (traces), 3 days (metrics), 2 days (logs)

## Next Steps

1. **Set up alerting** based on metrics thresholds
2. **Add Grafana** for advanced visualizations
3. **Configure sampling** to reduce data volume
4. **Add custom metrics** from your workflows
5. **Set up log aggregation** patterns

## Architecture Summary

```
┌─────────────┐     ┌─────────┐     ┌──────────┐     ┌───────────┐
│   MCP Agent │────▶│  Vector  │────▶│ Supabase │────▶│ Dashboard │
└─────────────┘     └─────────┘     └──────────┘     └───────────┘
     Generates         Collects         Stores          Displays
   - OTLP traces     - Metrics        - Time-series    - Real-time
   - Logs            - Logs           - Queryable      - Historical
   - Events          - Traces         - Persistent     - Actionable
```