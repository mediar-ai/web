# Windows MCP Service Management

Complete remote management system for the MCP (Model Context Protocol) agent as a Windows service using NSSM.

## 🚀 System Overview

**Components:**
- **MCPServer Service**: NSSM-managed terminator-mcp-agent.exe running on Windows VM (48.214.144.108:3389)
- **HTTP Management Server**: PowerShell script on port 8080  
- **Ngrok Tunnels**: External access via `https://vm-windows-1.ngrok.dev` (management) and `https://mcp-server-1.ngrok.app` (MCP server)
- **Monitoring**: Real-time logs and status dashboard

## 📋 Quick Start

### Local Setup (Windows VM)
```powershell
# 1. Install the MCP service
.\install-mcp-service-nssm.ps1

# 2. Install lock prevention (NEW!)
.\install-lock-prevention.ps1

# 3. Start management server
powershell -ExecutionPolicy Bypass -File C:\Users\terminatoradmin\Desktop\browser-workflow-capture-app-latest\windows-remote-service\windows_service_endpoint.ps1 -Port 8080  
# stop if needed
Get-Process powershell | Stop-Process -Force # stop all powershell processes

# 4. Start ngrok tunnels (for external access)
ngrok start --all --config scripts/ngrok.yml

# 5. Monitor logs
.\monitor_all_logs.ps1

# 6. Test lock prevention (optional)
.\test-lock-prevention.ps1
```

### External Access Commands
```bash
# Management Server Commands
# Health check
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/health"

# Service status
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/status"

# Restart service (PRIMARY USE CASE)
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/restart"

# Restart with specific version (NEW!)
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/restart-version?version=0.8.1"

# Upgrade to latest version
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/upgrade"

# Lock Prevention Commands (NEW!)
# Check lock prevention status
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/status"

# Safe RDP disconnect (use before disconnecting RDP)
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/tscon"

# Restart lock prevention service
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/restart"

# Local Lock Prevention Commands
# Test lock prevention manually
.\test-lock-prevention.ps1

# Run lock prevention in different modes
.\prevent-vm-lock-clean.ps1 -Mode interactive
.\prevent-vm-lock-clean.ps1 -Mode service  
.\prevent-vm-lock-clean.ps1 -Mode tscon-only
.\prevent-vm-lock-clean.ps1 -Mode status

# Safe RDP disconnect (alternative methods)
.\safe-disconnect-fixed.ps1
.\rdp-disconnect-safe.bat

# MCP Server Commands
# Health check
curl -H "ngrok-skip-browser-warning: true" "https://mcp-server-1.ngrok.app/health"

# MCP automation commands (examples)
curl -X POST "https://mcp-server-1.ngrok.app/tools/click_element" \
  -H "Content-Type: application/json" \
  -d '{"selector": "button[name=submit]"}'
```

## 🔧 Installation & Configuration

### Prerequisites
- **NSSM**: Download from https://nssm.cc/release/nssm-2.24.zip
- **Node.js**: Required for NPX-based installations
- **Administrator privileges**: Required for service operations

### Installation Options
```powershell
# Basic installation (latest version)
.\install-mcp-service-nssm.ps1

# Specific version
.\install-mcp-service-nssm.ps1 -Version "0.8.0"

# Force refresh (always download latest)
.\install-mcp-service-nssm.ps1 -ForceRefresh

# Clear cache before install
.\install-mcp-service-nssm.ps1 -ClearCache

# Use local binary
.\install-mcp-service-nssm.ps1 -ExecutablePath "C:\path\to\terminator-mcp-agent.exe"

# Custom service name and port
.\install-mcp-service-nssm.ps1 -ServiceName "MyMCPServer" -Port 3001
```

### Installation Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `NssmPath` | Path to nssm.exe | Auto-detect |
| `ExecutablePath` | Path to local binary (bypasses NPX) | Empty (uses NPX) |
| `Version` | NPX package version | "latest" |
| `Port` | HTTP port | 3000 |
| `Transport` | Transport type | "http" |
| `ServiceName` | Internal service name | "MCPServer" |
| `DisplayName` | Display name in Services | "MCP Server" |
| `ClearCache` | Clear NPX cache before install | False |
| `ForceRefresh` | Always download latest | False |

## 🔧 API Endpoints

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET | `/health` | Server health check | `{"status": "ok", "server": "NSSM Service Manager"}` |
| GET | `/version` | Server version info | `{"success": true, "version": "0.7.9", "git_commit": "0b95c77"}` |
| GET | `/status` | Service status | `{"success": true, "status": "Running", "name": "MCPServer"}` |
| POST | `/start` | Start service | `{"success": true, "action": "start", "message": "Service started successfully"}` |
| POST | `/stop` | Stop service | `{"success": true, "action": "stop", "message": "Service stopped successfully"}` |
| POST | `/restart` | Restart service | `{"success": true, "action": "restart", "message": "Service restarted successfully"}` |
| POST | `/restart-version` | Restart with specific version | `{"success": true, "action": "restart-version", "version": "0.8.1", "steps": [...]}` |
| POST | `/upgrade` | Upgrade to latest version | `{"success": true, "action": "upgrade", "steps": [...]}` |

## 🎯 Version Management (External Control)

### **NEW: Remote Version Control** 🚀

You can now **remotely restart the MCP service with any specific version** without manual VM access:

#### **Restart with Specific Version**
```bash
# Method 1: Query Parameter (Recommended)
curl -X POST -H "ngrok-skip-browser-warning: true" \
  "https://vm-windows-1.ngrok.dev/restart-version?version=0.8.1"

# Method 2: JSON Body
curl -X POST -H "ngrok-skip-browser-warning: true" \
  -H "Content-Type: application/json" \
  -d '{"version":"0.8.1"}' \
  "https://vm-windows-1.ngrok.dev/restart-version"

# Latest version (same as /upgrade)
curl -X POST -H "ngrok-skip-browser-warning: true" \
  "https://vm-windows-1.ngrok.dev/restart-version?version=latest"
```

#### **Response Format**
```json
{
  "success": true,
  "action": "restart-version",
  "message": "Service restarted with version 0.8.1 successfully",
  "version": "0.8.1",
  "steps": [
    "Stopping MCP service...",
    "Updating to version: 0.8.1",
    "Service configured for version: 0.8.1",
    "Starting MCP service...",
    "Service status: Running"
  ],
  "service_status": {
    "status": "Running",
    "name": "MCPServer"
  },
  "timestamp": "2025-01-15T16:56:28.133Z"
}
```

#### **Common Versions to Use**
- `0.8.1` - Stable version
- `0.9.0` - Feature update
- `0.9.3` - Latest stable (as of Jan 2025)
- `latest` - Always gets newest available

#### **Production Integration**
```javascript
// JavaScript/Node.js example
const restartWithVersion = async (version) => {
  const response = await fetch(
    `https://vm-windows-1.ngrok.dev/restart-version?version=${version}`, 
    {
      method: 'POST',
      headers: { 'ngrok-skip-browser-warning': 'true' }
    }
  );
  return await response.json();
};

// Usage
await restartWithVersion('0.8.1');
```

```python
# Python example
import requests

def restart_with_version(version):
    url = f"https://vm-windows-1.ngrok.dev/restart-version?version={version}"
    headers = {'ngrok-skip-browser-warning': 'true'}
    response = requests.post(url, headers=headers)
    return response.json()

# Usage
result = restart_with_version('0.8.1')
```

## 🔄 Deployment Method Switching

### Manual Commands (PowerShell Required)

The management server currently **does not support** switching deployment methods via curl. These operations require manual PowerShell commands:

#### Switch to Local Binary
```powershell
$nssmPath = "C:\Users\terminatoradmin\Desktop\terminator\scripts\nssm\nssm-2.24\win64\nssm.exe"
$binaryPath = "C:\Users\terminatoradmin\Desktop\terminator\target\release\terminator-mcp-agent.exe"

# Stop service
& $nssmPath stop MCPServer

# Update to local binary
& $nssmPath set MCPServer Application $binaryPath
& $nssmPath set MCPServer AppParameters "--port 3000 --transport http"

# Start service
& $nssmPath start MCPServer
```

#### Switch to NPX
```powershell
$nssmPath = "C:\Users\terminatoradmin\Desktop\terminator\scripts\nssm\nssm-2.24\win64\nssm.exe"

# Stop service
& $nssmPath stop MCPServer

# Update to NPX
& $nssmPath set MCPServer Application "C:\Program Files\nodejs\npx.cmd"
& $nssmPath set MCPServer AppParameters "-y terminator-mcp-agent@0.8.0 --port 3000 --transport http"

# Start service
& $nssmPath start MCPServer
```

#### Verify Deployment Method
```powershell
# Check current configuration
& $nssmPath get MCPServer Application
& $nssmPath get MCPServer AppParameters

# Or via curl (shows deployment method)
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/version"
```

### Limitations
- **No curl endpoints** for deployment switching
- **Manual PowerShell required** for switching methods
- **NPX upgrade endpoint** only works with NPX deployments
- **Local binary** deployments cannot use `/upgrade` endpoint

### Deployment Method Detection
The `/version` endpoint automatically detects:
- **NPX**: `"deployment_method": "NPX"` - if using `npx.cmd`
- **Local Binary**: `"deployment_method": "Local Binary"` - if using `.exe` file

### Benefits Comparison

| Feature | NPX Deployment | Local Binary |
|---------|---------------|--------------|
| Auto-upgrade via `/upgrade` | ✅ Yes | ❌ No |
| Version control | ✅ Automatic | 🔒 Manual |
| Startup time | ⚠️ Slower (cache check) | ⚡ Fast |
| Customization | ❌ No | ✅ Yes |
| Offline capability | ⚠️ Cache dependent | ✅ Yes |

## 📊 Version Management

### NPX Caching Behavior
- **First run**: Downloads and caches package
- **Subsequent runs**: Uses cached version (faster)
- **Cache location**: `%APPDATA%\npm-cache\_npx\`

### Upgrade Methods

#### 1. HTTP Endpoint (Recommended)
```bash
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/upgrade"
```

#### 2. Command Line
```powershell
.\upgrade-mcp-service.ps1 -Verbose
```

#### 3. Force Refresh Mode
```powershell
# Configure service to always download latest
.\install-mcp-service-nssm.ps1 -ForceRefresh

# Or modify existing service
nssm set MCPServer AppParameters "-y --force terminator-mcp-agent --port 3000 --transport http"
```

#### 4. Version Pinning
```powershell
# Install specific version
.\install-mcp-service-nssm.ps1 -Version "0.8.0"

# Upgrade to specific version
nssm set MCPServer AppParameters "-y terminator-mcp-agent@0.8.1 --port 3000 --transport http"
```

## 🌐 Access Methods

### Local Access (Windows VM)
- **Management Server**: `http://localhost:8080`
- **MCP Service**: `http://localhost:3000`
- **Ngrok Dashboard**: `http://127.0.0.1:4040`

### External Access (Worldwide)
- **Management Server**: `https://vm-windows-1.ngrok.dev` (Control MCP service)
- **MCP Server**: `https://mcp-server-1.ngrok.app` (Send automation commands)  
- **Required Header**: `ngrok-skip-browser-warning: true`

## 💻 Backend Integration

### JavaScript/Node.js
```javascript
const restartServer = async () => {
  const response = await fetch('https://vm-windows-1.ngrok.dev/restart', {
    method: 'POST',
    headers: {
      'ngrok-skip-browser-warning': 'true'
    }
  });
  
  return await response.json();
};

const upgradeServer = async () => {
  const response = await fetch('https://vm-windows-1.ngrok.dev/upgrade', {
    method: 'POST',
    headers: {
      'ngrok-skip-browser-warning': 'true'
    }
  });
  
  return await response.json();
};
```

### Python
```python
import requests

def restart_server():
    headers = {'ngrok-skip-browser-warning': 'true'}
    response = requests.post('https://vm-windows-1.ngrok.dev/restart', headers=headers)
    return response.json()

def upgrade_server():
    headers = {'ngrok-skip-browser-warning': 'true'}
    response = requests.post('https://vm-windows-1.ngrok.dev/upgrade', headers=headers)
    return response.json()
```

## 📊 Monitoring & Troubleshooting

### Real-Time Monitoring
```powershell
# All-in-one monitoring
.\monitor_all_logs.ps1

# Individual log files
Get-Content logs\mcp-server.log -Wait -Tail 50
Get-Content logs\mcp-server-error.log -Wait -Tail 50
```

### Web Interfaces
- **Ngrok Dashboard**: `http://127.0.0.1:4040` (HTTP request monitoring)
- **Service Logs**: `logs\mcp-server.log` and `logs\mcp-server-error.log`

### Status Commands
```powershell
# Service status
Get-Service MCPServer
nssm status MCPServer

# Process status
Get-Process terminator-mcp-agent -ErrorAction SilentlyContinue

# Port status
netstat -an | findstr :8080
netstat -an | findstr :3000
```

### Common Issues
```powershell
# Service stuck in "Paused" state
nssm remove MCPServer confirm
.\install-mcp-service-nssm.ps1

# Management server not responding
netstat -an | findstr :8080
Get-Process powershell | Where-Object {$_.ProcessName -eq "powershell"}

# Ngrok tunnel issues
ngrok diagnose
ngrok http 8080 --log stdout

# Clear NPX cache
npm cache clean --force
npx clear-npx-cache

# Check management server
netstat -an | findstr :8080
```

### Log Locations
- **Service Logs**: `logs\mcp-server.log`, `logs\mcp-server-error.log`
- **Management Server**: Console output
- **Ngrok Logs**: `http://127.0.0.1:4040` web interface

## 🔐 Security & Access

### Security Features
- **Firewall**: Port 8080 inbound allowed
- **Ngrok**: Uses persistent outbound tunnel (bypasses cloud provider firewalls)
- **CORS**: Configured for cross-origin access
- **HTTPS**: All external access encrypted via ngrok

### Platform-Specific Commands

#### Windows PowerShell (on VM)
```powershell
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/status"
```

#### macOS/Linux (external)
```bash
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/status"
```

## 📁 File Structure
```
windows-remote-service/
├── install-mcp-service-nssm.ps1     # Service installation
├── windows_service_endpoint.ps1     # HTTP management server
├── upgrade-mcp-service.ps1           # Command-line upgrade
├── monitor_all_logs.ps1              # Log monitoring
├── ngrok.yml                         # Ngrok configuration
├── README.md                         # This documentation
├── install-lock-prevention.ps1      # Lock prevention service installer
├── prevent-vm-lock-clean.ps1         # Lock prevention utility (clean version)
├── test-lock-prevention.ps1          # Lock prevention test suite
├── safe-disconnect-fixed.ps1         # Safe RDP disconnect (PowerShell)
├── rdp-disconnect-safe.bat           # Safe RDP disconnect (batch)
└── LOCK_PREVENTION_SETUP.md          # Lock prevention documentation

logs/
├── mcp-server.log                    # Service output
├── mcp-server-error.log             # Service errors
└── lock-prevention.log              # Lock prevention service logs
```

## 🎯 Success Indicators

✅ **System Healthy When:**
- Health check returns `{"status": "ok"}`
- Service status shows `"Running"`
- Ngrok shows `Session Status: online`
- Management server responds on port 8080

✅ **External Access Working When:**
- Commands work from external IP addresses
- No firewall/port blocking errors
- Fast response times (<100ms)

## 🚀 Best Practices

1. **Production Setup**: Use version pinning (`-Version "0.8.0"`)
2. **Development Setup**: Use force refresh (`-ForceRefresh`)
3. **Monitoring**: Set up log rotation and monitoring
4. **Security**: Use firewall rules and internal networks
5. **Upgrades**: Test in development before production
6. **Backend Integration**: Use retry logic and error handling

---

**System Status**: ✅ **FULLY OPERATIONAL**  
**Last Updated**: 2025-01-15  
**Primary Use Case**: Remote MCP version control, server restart, and upgrade from backend applications with VM lock prevention  
**NEW FEATURE**: 🚀 **External Version Control** - Restart with any specific MCP version via API