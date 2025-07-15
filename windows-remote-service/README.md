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
# 1. Install the service
.\install-mcp-service-nssm.ps1

# 2. Start management server
powershell -ExecutionPolicy Bypass -File C:\Users\terminatoradmin\Desktop\browser-workflow-capture-app-latest\windows-remote-service\windows_service_endpoint.ps1 -Port 8080  
# stop if needed
Get-Process powershell | Stop-Process -Force # stop all powershell processes

# 3. Start ngrok tunnels (for external access)
ngrok start --all --config scripts/ngrok.yml

# 4. Monitor logs
.\monitor_all_logs.ps1
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

# Upgrade to latest version
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/upgrade"

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
| POST | `/upgrade` | Upgrade to latest version | `{"success": true, "action": "upgrade", "steps": [...]}` |

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
├── install-mcp-service-nssm.ps1    # Service installation
├── windows_service_endpoint.ps1     # HTTP management server
├── upgrade-mcp-service.ps1          # Command-line upgrade
├── monitor_all_logs.ps1             # Log monitoring
├── ngrok.yml                        # Ngrok configuration
└── README.md                        # This documentation

logs/
├── mcp-server.log                   # Service output
└── mcp-server-error.log            # Service errors
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
**Last Updated**: 2025-01-14  
**Primary Use Case**: Programmatic server restart and upgrade from backend applications