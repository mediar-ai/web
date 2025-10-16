# Testing Guide

This guide explains how to test the Rust Workflow Executor locally before deploying to production.

## Quick Start: Local Integration Test

The easiest way to verify everything works is to run the integration test:

```bash
cd rust-executor
./scripts/run_integration_test.sh
```

This will automatically:
- ✓ Build Terminator MCP agent if needed
- ✓ Load your `.env` configuration
- ✓ Run a complete workflow with browser automation and screenshot capture
- ✓ Verify the integration works end-to-end

## What Gets Tested

The integration test validates the complete pipeline:

1. **MCP Communication**
   - Stdio transport connection to Terminator
   - Tool discovery and listing
   - Request/response handling

2. **Workflow Execution**
   - Workflow validation
   - Step-by-step execution
   - Error handling strategies

3. **Browser Automation**
   - Browser navigation
   - Element waiting
   - Screenshot capture

4. **Screenshot Upload** (if Supabase configured)
   - Base64 image extraction
   - Upload to Supabase Storage
   - URL generation with signed access

## Setup Requirements

### Minimal Setup (Screenshot Capture Only)

1. **Clone Terminator repository:**
   ```bash
   cd /path/to/mediar-web-app
   git clone https://github.com/mediar-ai/terminator.git
   ```

2. **Create `.env` file in rust-executor/:**
   ```bash
   cp .env.example .env
   ```

3. **Run the test:**
   ```bash
   ./scripts/run_integration_test.sh
   ```

### Full Setup (With Supabase Upload)

Add to your `.env`:

```bash
SUPABASE_URL=https://eshwntsgsputksqamckh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Now screenshots will be uploaded to Supabase Storage at:
```
screenshots/{organization_id}/{execution_id}/screenshot.png
```

## Running Individual Tests

### Integration Test (Recommended)

Full end-to-end test with real MCP server:

```bash
cargo run --example test_screenshot_integration
```

### Unit Tests

Fast isolated tests:

```bash
cargo test
```

### Database Integration Tests

Requires PostgreSQL connection:

```bash
cargo test --all --features integration
```

## Interpreting Results

### Successful Test Output

```
================================================================
🧪 Rust Executor + Terminator MCP Integration Test
================================================================

✓ Supabase configured - screenshots will be uploaded

1. Starting Terminator MCP server...
   Using terminator binary: ../terminator/target/release/terminator-mcp-agent.exe

2. Testing MCP connection...
   ✓ Connected! Available tools: 67

3. Creating test workflow...
   ✓ Workflow is valid with 3 steps

4. Executing workflow with screenshot capture...
   Execution ID: 12345678-1234-1234-1234-123456789abc

5. Workflow execution completed!
   Status: SUCCESS ✓
   Message: Workflow completed successfully
   Steps completed: 3/3
   Execution time: 5432ms

6. Checking screenshot results...
   ✓ Screenshot captured successfully!
   Screenshot data found in result
   ✓ Screenshot uploaded to Supabase:
     URL: https://eshwntsgsputksqamckh.supabase.co/storage/v1/...

================================================================
✅ Integration test completed!
================================================================
```

### Common Warnings (Not Failures)

**⚠️ Warning: Supabase credentials not configured**
- Screenshots are captured but not uploaded
- Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable upload

**⚠ Screenshot captured but not uploaded to Supabase**
- Check Supabase credentials are correct
- Verify storage bucket exists and has write permissions

## Troubleshooting

### Terminator Binary Not Found

**Error:**
```
✗ Terminator binary not found at: ../terminator/target/release/terminator-mcp-agent.exe
```

**Fix:**
```bash
cd ../terminator
cargo build --release --package terminator-mcp-agent
```

### MCP Connection Failed

**Error:**
```
✗ Failed to connect to MCP server
```

**Possible causes:**
1. Terminator binary missing or corrupted
2. Chrome extension not installed
3. Accessibility permissions not granted (macOS)

**Fix:**
```bash
# Rebuild terminator
cd ../terminator
cargo clean
cargo build --release --package terminator-mcp-agent

# Run terminator setup
terminator setup
```

### Browser Not Opening

**Error:**
```
Error: ElementNotFound: Browser window not found
```

**Possible causes:**
1. Chrome not installed
2. Browser blocked by security software

**Fix:**
- Install Chrome: https://www.google.com/chrome/
- Temporarily disable antivirus/firewall
- On Windows: Run as administrator

### Screenshot Upload Failed

**Error:**
```
⚠ Screenshot captured but not uploaded to Supabase
```

**Debug steps:**

1. **Check credentials:**
   ```bash
   # Verify .env file
   cat .env | grep SUPABASE
   ```

2. **Test Supabase connection:**
   ```bash
   curl -X GET "${SUPABASE_URL}/rest/v1/" \
     -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
   ```

3. **Verify storage bucket:**
   - Log into Supabase dashboard
   - Navigate to Storage
   - Ensure `screenshots` bucket exists
   - Check bucket has write permissions for service role

4. **Check logs:**
   ```bash
   RUST_LOG=debug cargo run --example test_screenshot_integration
   ```

## Before Deploying to Azure

Always run the integration test successfully before deploying:

```bash
# 1. Run integration test
./scripts/run_integration_test.sh

# 2. If successful, deploy to Azure
./deploy-azure.sh dev
```

This ensures:
- ✓ MCP integration works correctly
- ✓ Screenshot capture is functional
- ✓ Supabase upload is configured properly
- ✓ No regressions in workflow execution

## CI/CD Integration

To run tests in CI pipelines:

```yaml
# .github/workflows/test.yml
- name: Run Integration Tests
  run: |
    cd rust-executor
    ./scripts/run_integration_test.sh
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Next Steps

After successful local testing:

1. **Deploy to Azure:**
   ```bash
   ./deploy-azure.sh dev
   ```

2. **Test deployment:**
   ```bash
   # Test health endpoint
   curl http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health

   # Test workflow execution
   curl -X POST http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/executions \
     -H "Content-Type: application/json" \
     -d '{"workflow_id": "your-workflow-id", ...}'
   ```

3. **Monitor logs:**
   ```bash
   az container logs -n workflow-executor-dev -g mediar-workflow-executor-rg
   ```

4. **Check screenshots in Supabase:**
   - Log into Supabase dashboard
   - Navigate to Storage → screenshots bucket
   - Verify files are being uploaded

## Getting Help

If you encounter issues:

1. Check this troubleshooting guide
2. Review test output and logs
3. Enable debug logging: `export RUST_LOG=debug`
4. Check terminator documentation: https://github.com/mediar-ai/terminator
5. Open an issue with full error output
