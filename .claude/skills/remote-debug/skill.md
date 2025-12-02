---
name: remote-debug
description: Debug workflows on remote MCP machines using terminator CLI. Auto-activates when user says "debug workflow", "analyze UI", "inspect element", "check desktop", "run terminator", "connect to machine", or wants to troubleshoot workflow execution failures on remote VMs.
allowed-tools: Bash, Read, Write
---

# Remote Workflow Debugging Skill

Debug and troubleshoot workflows on remote MCP-enabled Windows VMs using the terminator CLI.

## Auth Fix (rmcp 0.9)

**FIXED**: The auth bug in rmcp 0.6.3 has been fixed by upgrading to rmcp 0.9 in terminator-cli. Authentication now works correctly with `MCP_AUTH_TOKEN` environment variable.

---

## Prerequisites

1. **Terminator CLI** installed: `cargo install terminator-cli` or from source
2. **MCP endpoint URL** from target machine
3. **Auth token**: `<auth_token>` (Packer image default)

---

## Step 1: Get Machine Info

```bash
cat > /tmp/get_machine.sh << 'EOF'
#!/bin/bash
cd .
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')
MACHINE_ID=${1:-22}

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,status,health_status&id=eq.${MACHINE_ID}" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq '.[0]'
EOF
bash /tmp/get_machine.sh 22
```

**List all machines:**
```bash
cat > /tmp/list_machines.sh << 'EOF'
#!/bin/bash
cd .
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env.local | cut -d '=' -f2 | tr -d '"')
SUPABASE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env.local | cut -d '=' -f2 | tr -d '"')

curl -s "${SUPABASE_URL}/rest/v1/remote_machines?select=id,name,mcp_endpoint,status&order=name" \
  -H "apikey: ${SUPABASE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_KEY}" | jq -r '.[] | "[\(.id)] \(.name) - \(.status)"'
EOF
bash /tmp/list_machines.sh
```

---

## Step 2: Debug with run_command + JS Code

Use `terminator mcp exec` with `run_command` tool to execute JavaScript debugging code:

### Basic Pattern

```bash
# Set machine IP and auth token
export MCP_URL="http://<IP>:8080/mcp"
export MCP_AUTH_TOKEN="<auth_token>"

# Execute run_command with JS code
terminator mcp exec --url "$MCP_URL" run_command '{
  "run": "node -e \"console.log(JSON.stringify({cwd: process.cwd(), env: Object.keys(process.env).slice(0,5)}))\"",
  "timeout_seconds": 10
}'
```

### Debug Helper Script

```bash
cat > /tmp/mcp_run.sh << 'EOF'
#!/bin/bash
# Usage: bash /tmp/mcp_run.sh <MACHINE_IP> '<JS_CODE>'
IP="${1:-<IP>}"
JS_CODE="${2:-console.log('hello')}"
AUTH_TOKEN="<auth_token>"

export MCP_AUTH_TOKEN="$AUTH_TOKEN"
terminator mcp exec --url "http://${IP}:8080/mcp" run_command "{
  \"command\": \"node -e \\\"${JS_CODE}\\\"\",
  \"timeout_seconds\": 30
}"
EOF
chmod +x /tmp/mcp_run.sh
```

---

## Common Debug Commands

### 1. Check Running Processes

```bash
export MCP_AUTH_TOKEN="<auth_token>"
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "tasklist /FI \"IMAGENAME eq OneDrive.exe\" /FO TABLE",
  "timeout_seconds": 10
}'
```

### 2. Check File Exists

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "dir \"%USERPROFILE%\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe\"",
  "timeout_seconds": 5
}'
```

### 3. Get Desktop UI Tree

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" get_desktop_elements '{
  "depth": 1
}'
```

### 4. Get Process-Specific UI Tree

```bash
# OneDrive UI tree
terminator mcp exec --url "http://<IP>:8080/mcp" get_desktop_elements '{
  "selector": "process:OneDrive",
  "depth": 3
}'

# Chrome UI tree
terminator mcp exec --url "http://<IP>:8080/mcp" get_desktop_elements '{
  "selector": "process:chrome",
  "depth": 3
}'
```

### 5. Take Screenshot

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" take_screenshot '{}'
```

### 6. Run PowerShell Script

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "powershell -Command \"Get-Process | Where-Object {$_.ProcessName -like '*OneDrive*'} | Select-Object ProcessName, Id, MainWindowTitle\"",
  "timeout_seconds": 15
}'
```

### 7. Check Window State

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "powershell -Command \"Get-Process OneDrive -ErrorAction SilentlyContinue | Select-Object MainWindowHandle, MainWindowTitle\"",
  "timeout_seconds": 10
}'
```

---

## Debug JS Code Examples

### Analyze OneDrive Installation

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "node -e \"const fs=require('fs'); const path='C:\\\\Users\\\\%USERNAME%\\\\AppData\\\\Local\\\\Microsoft\\\\OneDrive\\\\OneDrive.exe'; console.log(JSON.stringify({exists: fs.existsSync(path), path}))\"",
  "timeout_seconds": 10
}'
```

### List Directory Contents

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "node -e \"const fs=require('fs'); const dir='C:\\\\Users\\\\%USERNAME%\\\\AppData\\\\Local\\\\Microsoft\\\\OneDrive'; try{console.log(JSON.stringify(fs.readdirSync(dir).slice(0,20)))}catch(e){console.log(JSON.stringify({error:e.message}))}\"",
  "timeout_seconds": 10
}'
```

### Check Environment

```bash
terminator mcp exec --url "http://<IP>:8080/mcp" run_command '{
  "run": "node -e \"console.log(JSON.stringify({user: process.env.USERNAME, home: process.env.USERPROFILE, cwd: process.cwd()}))\"",
  "timeout_seconds": 5
}'
```

---

## MCP Tool Reference

| Tool | Description | Args |
|------|-------------|------|
| `run_command` | Execute shell/JS command | `{"run": "...", "timeout_seconds": N}` |
| `get_desktop_elements` | Get UI tree | `{"selector": "...", "depth": N}` |
| `take_screenshot` | Capture screen | `{"selector": "..."}` (optional) |
| `click_element` | Click UI element | `{"selector": "process:App\|role:Button\|name:OK"}` |
| `type_text` | Type into element | `{"selector": "...", "text": "..."}` |
| `press_key` | Press keyboard key | `{"key": "enter"}` or `{"key": "ctrl+a"}` |
| `wait_for_element` | Wait for element | `{"selector": "...", "timeout_seconds": N}` |
| `open_application` | Launch app | `{"path": "C:\\path\\to\\app.exe"}` |

---

## Selector Syntax

**CRITICAL**: Always use `process:` prefix for click/type actions!

```
process:OneDrive|role:Button|name:Sign in
process:chrome|role:Edit|name:Address and search bar
process:explorer|role:Window|name:File Explorer
```

**Components:**
- `process:NAME` - Target specific application (REQUIRED)
- `role:TYPE` - UI Automation role (Button, Edit, Window, Text)
- `name:TEXT` - Element name (supports wildcards: `name:*partial*`)
- `id:ID` - Automation ID

---

## Troubleshooting

### "401 Unauthorized"
- Check `MCP_AUTH_TOKEN` is set correctly (`export MCP_AUTH_TOKEN="<auth_token>"`)
- Ensure terminator-cli is built with rmcp 0.9+ (the auth fix)

### "Element not found"
- Element not visible on screen
- Wrong process name (case-sensitive!)
- Take screenshot to see current state

### "Connection refused"
- MCP server not running on VM
- Check health: `curl http://<IP>:8080/health`

---

## Debug Session Example

```bash
# Set up
export MCP_AUTH_TOKEN="<auth_token>"
export MCP_URL="http://<IP>:8080/mcp"

# 1. Check if OneDrive is installed
terminator mcp exec --url "$MCP_URL" run_command '{"run": "dir \"%USERPROFILE%\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe\"", "timeout_seconds": 5}'

# 2. Check if OneDrive is running
terminator mcp exec --url "$MCP_URL" run_command '{"run": "tasklist /FI \"IMAGENAME eq OneDrive.exe\"", "timeout_seconds": 5}'

# 3. Get desktop UI tree
terminator mcp exec --url "$MCP_URL" get_desktop_elements '{"depth": 1}'

# 4. If OneDrive running, get its UI tree
terminator mcp exec --url "$MCP_URL" get_desktop_elements '{"selector": "process:OneDrive", "depth": 4}'

# 5. Take screenshot
terminator mcp exec --url "$MCP_URL" take_screenshot '{}'

# 6. Launch OneDrive if not running
terminator mcp exec --url "$MCP_URL" open_application '{"path": "%USERPROFILE%\\AppData\\Local\\Microsoft\\OneDrive\\OneDrive.exe"}'

# 7. Wait for window
terminator mcp exec --url "$MCP_URL" wait_for_element '{"selector": "process:OneDrive|role:Window", "timeout_seconds": 30}'
```
