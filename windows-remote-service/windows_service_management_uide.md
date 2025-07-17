# Windows Service Management System Guide

## 🚀 **System Overview**
Complete remote management system for MCPServer service on Windows VM (48.214.144.108:3389)

**Components:**
- **MCPServer Service**: NSSM-managed terminator-mcp-agent.exe
- **HTTP Management Server**: PowerShell script on port 8080
- **Ngrok Tunnels**: External access via `https://vm-windows-1.ngrok.dev` (management) and `https://mcp-server-1.ngrok.app` (MCP server)
- **Monitoring**: Real-time logs and status dashboard

---

## 📋 **Quick Start Commands**

### **On Windows VM (Local)**
```powershell
# Start management server
powershell -ExecutionPolicy Bypass -File scripts\windows_service_endpoint.ps1

# Start ngrok tunnels
ngrok start --all --config scripts/ngrok.yml

# Monitor all logs
scripts\monitor_all_logs.ps1

# Manual service commands
nssm start MCPServer
nssm stop MCPServer
nssm restart MCPServer
```

### **From Anywhere (External)**
```bash
# Management Server Commands
# Health check
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/health"

# Server version info
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/version"

# Service status
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/status"

# Start service
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/start"

# Stop service
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/stop"

# Restart service (PRIMARY USE CASE)
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/restart"

# MCP Server Commands
# Health check
curl -H "ngrok-skip-browser-warning: true" "https://mcp-server-1.ngrok.app/health"

# MCP automation commands (examples)
curl -X POST "https://mcp-server-1.ngrok.app/tools/click_element" \
  -H "Content-Type: application/json" \
  -d '{"selector": "button[name=submit]"}'
```

---

## 🔧 **API Endpoints**

| Method | Endpoint | Description | Response |
|--------|----------|-------------|----------|
| GET    | `/health` | Server health check | `{"status": "ok", "server": "NSSM Service Manager"}` |
| GET    | `/version` | Server version info | `{"success": true, "version": "0.7.9", "git_commit": "0b95c77"}` |
| GET    | `/status` | Service status | `{"success": true, "status": "Running", "name": "MCPServer"}` |
| POST   | `/start` | Start service | `{"success": true, "action": "start", "message": "Service started successfully"}` |
| POST   | `/stop` | Stop service | `{"success": true, "action": "stop", "message": "Service stopped successfully"}` |
| POST   | `/restart` | Restart service | `{"success": true, "action": "restart", "message": "Service restarted successfully"}` |

---

## 📊 **Monitoring Dashboard**

### **Real-Time Logs**
```powershell
# All-in-one monitoring
scripts\monitor_all_logs.ps1

# Individual log files
Get-Content logs\mcp-server.log -Wait -Tail 50
Get-Content logs\mcp-server-error.log -Wait -Tail 50
```

### **Web Interfaces**
- **Ngrok Dashboard**: `http://127.0.0.1:4040` (HTTP request monitoring)
- **Service Logs**: `logs\mcp-server.log` and `logs\mcp-server-error.log`

### **Status Commands**
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

---

## 🌐 **Access Methods**

### **Local Access (Windows VM)**
- **Management Server**: `http://localhost:8080`
- **MCP Service**: `http://localhost:3000`
- **Ngrok Dashboard**: `http://127.0.0.1:4040`

### **External Access (Worldwide)**
- **Management Server**: `https://vm-windows-1.ngrok.dev` (Control MCP service)
- **MCP Server**: `https://mcp-server-1.ngrok.app` (Send automation commands)  
- **Required Header**: `ngrok-skip-browser-warning: true`

---

## 🔨 **Backend Integration**

### **JavaScript/Node.js**
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
```

### **Python**
```python
import requests

def restart_server():
    headers = {'ngrok-skip-browser-warning': 'true'}
    response = requests.post('https://vm-windows-1.ngrok.dev/restart', headers=headers)
    return response.json()
```

---

## 🚨 **Troubleshooting**

### **Common Issues**
```powershell
# Service stuck in "Paused" state
nssm remove MCPServer confirm
nssm install MCPServer "C:\Users\terminatoradmin\Desktop\terminator\target\release\terminator-mcp-agent.exe"

# Management server not responding
netstat -an | findstr :8080
Get-Process powershell | Where-Object {$_.ProcessName -eq "powershell"}

# Ngrok tunnel issues
ngrok diagnose
ngrok http 8080 --log stdout
```

### **Log Locations**
- **Service Logs**: `logs\mcp-server.log`, `logs\mcp-server-error.log`
- **Management Server**: Console output
- **Ngrok Logs**: `http://127.0.0.1:4040` web interface

---

## 🔐 **Security Notes**

- **Firewall**: Port 8080 allowed inbound
- **Ngrok**: Uses persistent outbound tunnel (bypasses cloud provider firewalls)
- **CORS**: Configured for cross-origin access
- **HTTPS**: All external access encrypted via ngrok

---

## 📁 **File Structure**
```
scripts/
├── windows_service_endpoint.ps1    # HTTP management server
├── monitor_all_logs.ps1            # Real-time monitoring
├── nssm/                           # NSSM service manager
└── windows_service_management_guide.md  # This file

logs/
├── mcp-server.log                  # Service output
└── mcp-server-error.log           # Service errors
```

---

## ⚡ **Platform-Specific Commands**

### **Windows PowerShell** (on VM)
```powershell
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/status"
```

### **macOS/Linux** (external)
```bash
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/status"
```

---

## 🎯 **Success Indicators**

✅ **System Healthy When:**
- Health check returns `{"status": "ok"}`
- Service status shows `"Running"`
- Ngrok shows `Session Status: online`
- Management server responds on port 8080

✅ **External Access Working When:**
- Commands work from external IP addresses
- No firewall/port blocking errors
- Fast response times (<100ms)

---

**System Status**: ✅ **FULLY OPERATIONAL**
**Last Updated**: 2025-01-14
**Primary Use Case**: Programmatic server restart from backend application 