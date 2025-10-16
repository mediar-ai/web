# Integration Test Examples

This directory contains integration test examples for the Rust Workflow Executor.

## test_screenshot_integration.rs

**Purpose:** End-to-end integration test that validates the complete workflow execution pipeline with screenshot capture and upload.

**What it tests:**
1. **MCP Connection**: Connects to Terminator MCP server via stdio transport
2. **Tool Discovery**: Lists available desktop automation tools
3. **Workflow Execution**: Runs a multi-step workflow with browser automation
4. **Screenshot Capture**: Uses MCP tools to capture page screenshots
5. **Supabase Upload**: Verifies screenshots are uploaded to cloud storage (if configured)

**Run it:**
```bash
# Using the convenience script (recommended)
../scripts/run_integration_test.sh

# Or run directly
cargo run --example test_screenshot_integration
```

**Prerequisites:**
- Terminator MCP agent built: `cd ../../terminator && cargo build --release --package terminator-mcp-agent`
- Chrome browser installed
- Environment variables in `../.env` (optional for Supabase upload):
  ```bash
  SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
  ```

**Workflow:**
```yaml
steps:
  1. navigate_browser → https://example.com
  2. wait_for_element → role:Document
  3. capture_element_screenshot → role:Document
```

**Expected Output:**
```
================================================================
✅ Integration test completed!

Test Summary:
  1. ✓ Connected to Terminator MCP server via stdio
  2. ✓ Listed available automation tools
  3. ✓ Created and validated workflow with screenshot capture
  4. ✓ Executed workflow with browser automation
  5. ✓ Screenshot capture and upload

💡 To test Supabase upload, check the execution in your dashboard
   Execution ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## test_stdio_mcp.rs

**Purpose:** Basic stdio transport test for MCP communication.

Tests the fundamental MCP client connection using stdio transport to the Terminator agent.

**Run it:**
```bash
cargo run --example test_stdio_mcp
```

## test_mcp_execution.rs

**Purpose:** HTTP transport test for MCP server (legacy).

Tests connecting to a running MCP server via HTTP endpoint.

**Run it:**
```bash
# Start MCP server first
npx -y terminator-mcp-agent -t http -p 3000

# Then run test
cargo run --example test_mcp_execution
```

## Debugging Integration Tests

### Enable Debug Logging
```bash
export RUST_LOG=debug
cargo run --example test_screenshot_integration
```

### Check Terminator Logs
If the test fails, check terminator MCP logs:
```powershell
# Windows PowerShell
Get-ChildItem (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'claude-cli-nodejs\Cache\*\mcp-logs-terminator-mcp-agent\*.txt') | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Tail 50
```

### Common Issues

**Terminator binary not found:**
```bash
cd ../../terminator
cargo build --release --package terminator-mcp-agent
```

**Browser not opening:**
- Ensure Chrome is installed
- Check if terminator has accessibility permissions (macOS)
- On Windows, run with administrator privileges if needed

**Screenshot not uploading:**
- Verify SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set
- Check Supabase storage bucket exists and has correct permissions
- Look for upload errors in test output

**MCP connection timeout:**
- Ensure terminator binary path is correct
- Check RUST_LOG output for connection errors
- Verify no other MCP server is using the same port
