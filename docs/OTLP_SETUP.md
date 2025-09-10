# OpenTelemetry Setup for MCP Agents

## Configure Rust Agents to Send Traces to Next.js

The dashboard now includes an OTLP receiver endpoint that can collect OpenTelemetry traces directly from your Rust MCP agents.

### 1. Enable Telemetry in Rust Agent

Make sure the telemetry feature is enabled when building the MCP agent:

```bash
cd terminator-mcp-agent
cargo build --features telemetry
```

### 2. Set Environment Variables

Configure each VM/agent to send OTLP data to your Next.js app:

```bash
# For local development
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:3000/api/internal/otlp"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
export OTEL_SERVICE_NAME="mcp-agent-vm1"

# For production (replace with your actual URL)
export OTEL_EXPORTER_OTLP_ENDPOINT="https://your-app.vercel.app/api/internal/otlp"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/json"
export OTEL_SERVICE_NAME="mcp-agent-production"
```

### 3. For Azure VMs

Add these environment variables to your VM setup script:

```powershell
# In your Azure VM setup script
[System.Environment]::SetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT", "https://your-app.com/api/internal/otlp", "Machine")
[System.Environment]::SetEnvironmentVariable("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json", "Machine")
[System.Environment]::SetEnvironmentVariable("OTEL_SERVICE_NAME", "mcp-agent-$env:COMPUTERNAME", "Machine")
```

### 4. Verify Traces are Being Sent

1. Navigate to `/internal/dashboard`
2. Click on the "OpenTelemetry Traces" tab
3. You should see workflow traces appearing with:
   - Trace IDs
   - Span hierarchies
   - Execution durations
   - Tool names and attributes

### 5. What Gets Collected

The Rust agent sends:
- **WorkflowSpan**: Overall workflow execution
- **StepSpan**: Individual tool executions
- Attributes like:
  - `workflow.name`
  - `tool.name`
  - `step.id`
  - Error messages and status codes

### Troubleshooting

If traces aren't appearing:

1. Check the Rust agent logs for OTLP export errors
2. Verify network connectivity from VM to Next.js app
3. Check browser console for any errors in the dashboard
4. Ensure the telemetry feature flag is enabled in Rust build

### Direct Testing

You can test the OTLP endpoint directly:

```bash
curl -X POST http://localhost:3000/api/internal/otlp/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "resourceSpans": [{
      "scopeSpans": [{
        "spans": [{
          "traceId": "test123",
          "spanId": "span456",
          "name": "test.workflow",
          "startTimeUnixNano": "'$(date +%s%N)'",
          "endTimeUnixNano": "'$(date +%s%N)'",
          "attributes": [{
            "key": "workflow.name",
            "value": {"stringValue": "Test Workflow"}
          }]
        }]
      }]
    }]
  }'
```