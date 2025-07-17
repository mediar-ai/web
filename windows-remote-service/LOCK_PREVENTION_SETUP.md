# Windows VM Lock Prevention Setup Guide

Complete lock prevention system for maintaining desktop automation when RDP sessions are disconnected.

## 🚀 System Overview

This lock prevention system integrates seamlessly with your existing MCP service management infrastructure to ensure Windows VMs remain unlocked and accessible for desktop automation even when RDP sessions are disconnected.

**Components:**
- **Lock Prevention Service**: NSSM-managed service that monitors and prevents VM locking
- **TSCON Utility**: Safe RDP disconnection using Windows built-in session transfer
- **HTTP Management**: Lock prevention endpoints integrated into existing management server
- **Power Management**: Automated power plan configuration for automation workloads
- **Activity Simulation**: Keeps system awake using Windows execution state APIs

---

## 📋 Quick Start

### 1. Install Lock Prevention Service

```powershell
# Run as Administrator from windows-remote-service directory
.\install-lock-prevention.ps1

# Or with custom settings
.\install-lock-prevention.ps1 -CheckInterval 60 -EnableActivitySimulation
```

### 2. Verify Installation

```powershell
# Check service status
nssm status VMLockPrevention

# Test lock prevention features
.\prevent-vm-lock.ps1 -Mode status
```

### 3. Safe RDP Disconnection

Before disconnecting your RDP session, run:
```batch
# Right-click "Run as administrator"
.\rdp-disconnect-safe.bat
```

Or use the HTTP endpoint:
```bash
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/tscon"
```

---

## 🔧 Installation Options

### Basic Installation (Recommended)
```powershell
.\install-lock-prevention.ps1
```

**Default Features:**
- ✅ TSCON session management
- ✅ Power management optimization
- ❌ Activity simulation (minimal system impact)
- ✅ Auto-start with Windows
- ✅ 30-second monitoring interval

### Advanced Installation
```powershell
.\install-lock-prevention.ps1 -EnableActivitySimulation -CheckInterval 15
```

**Advanced Features:**
- ✅ All basic features
- ✅ Activity simulation (prevents sleep via Windows APIs)
- ⚡ Faster monitoring (15-second intervals)

### Uninstall
```powershell
.\install-lock-prevention.ps1 -Uninstall
```

---

## 🌐 HTTP Management Endpoints

The lock prevention system integrates with your existing HTTP management server on port 8080.

### Check Lock Prevention Status
```bash
curl -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/status"
```

**Response:**
```json
{
  "success": true,
  "action": "lock-prevention-status",
  "lock_prevention": {
    "TsconEnabled": true,
    "PowerManagementEnabled": true,
    "ActivitySimulationEnabled": false,
    "IsElevated": true,
    "CurrentSessions": [
      {
        "Username": "terminatoradmin",
        "SessionId": 2,
        "State": "Active"
      }
    ]
  },
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

### Execute Safe TSCON Disconnect
```bash
# Use this before disconnecting RDP
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/tscon"
```

### Service Management
```bash
# Start lock prevention service
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/start"

# Stop lock prevention service  
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/stop"

# Restart lock prevention service
curl -X POST -H "ngrok-skip-browser-warning: true" "https://vm-windows-1.ngrok.dev/lock-prevention/restart"
```

---

## 📊 Monitoring and Logs

### Log Files
```
windows-remote-service/logs/
├── lock-prevention.log          # Main application logs
├── lock-prevention-stdout.log   # Service stdout
└── lock-prevention-stderr.log   # Service errors
```

### Monitor Logs in Real-time
```powershell
# Use existing monitoring script
.\monitor_all_logs.ps1

# Or monitor lock prevention specifically
Get-Content -Path "logs\lock-prevention.log" -Tail 50 -Wait
```

### Status Monitoring
```powershell
# Check all services including lock prevention
nssm status MCPServer
nssm status VMLockPrevention

# Detailed lock prevention status
.\prevent-vm-lock.ps1 -Mode status | ConvertFrom-Json
```

---

## 🔒 How It Works

### TSCON Session Management
1. **Detection**: Monitors for disconnected RDP sessions
2. **Transfer**: Uses `tscon.exe` to transfer session to console
3. **Preservation**: Keeps all programs running normally
4. **Access**: Maintains interactive desktop for automation

### Power Management
- Disables sleep/hibernation timeouts
- Sets high-performance power plan
- Configures optimal settings for automation

### Activity Simulation (Optional)
- Uses Windows `SetThreadExecutionState` API
- Prevents system from entering sleep mode
- Maintains display required state
- No artificial mouse/keyboard input

### Session Monitoring
```
RDP Session States:
Active    → Running normally ✅
Disc      → Disconnected (TSCON targets these) ⚠️
Listen    → Waiting for connection ⏳
```

---

## 🚨 Troubleshooting

### Common Issues

**Service won't start:**
```powershell
# Check if running as administrator
whoami /groups | findstr "S-1-5-32-544"

# Check service status
nssm status VMLockPrevention

# View service logs
Get-Content "logs\lock-prevention-stderr.log"
```

**TSCON fails:**
```powershell
# Verify session exists
query user

# Test manual TSCON
tscon 2 /dest:console  # Replace 2 with your session ID
```

**Power settings not applied:**
```powershell
# Check current power plan
powercfg /getactivescheme

# Verify timeouts
powercfg /query
```

### Resolution Steps

1. **Ensure Administrator Rights**: All lock prevention operations require administrator privileges
2. **Check NSSM Installation**: Verify `nssm.exe` is available in the script directory
3. **Review Logs**: Check logs for specific error messages
4. **Test Components**: Use `-Mode status` to verify system state

### Advanced Diagnostics
```powershell
# Test lock prevention script directly
.\prevent-vm-lock.ps1 -Mode interactive -Verbose

# Check Windows session information
query user
query session

# Verify power configuration
powercfg /list
powercfg /query SCHEME_CURRENT SUB_SLEEP
```

---

## ⚙️ Configuration

### Service Configuration

**Location**: Windows Services → `VM Lock Prevention Service`

**Key Settings:**
- **Startup Type**: Automatic
- **Recovery**: Restart on failure
- **Dependencies**: None (runs independently)

### Script Parameters

The `prevent-vm-lock.ps1` script supports several configuration options:

```powershell
# Interactive mode (for testing)
.\prevent-vm-lock.ps1 -Mode interactive -Verbose

# Service mode (used by NSSM)
.\prevent-vm-lock.ps1 -Mode service -CheckIntervalSeconds 30

# One-time TSCON operation
.\prevent-vm-lock.ps1 -Mode tscon-only

# Status check
.\prevent-vm-lock.ps1 -Mode status
```

### Customization Options

**Check Interval**: How often to monitor sessions (default: 30 seconds)
```powershell
.\install-lock-prevention.ps1 -CheckInterval 60  # Check every minute
```

**Feature Toggles**:
```powershell
# Enable all features
.\install-lock-prevention.ps1 -EnableTscon -EnablePowerManagement -EnableActivitySimulation

# Minimal installation (TSCON only)
.\install-lock-prevention.ps1 -EnablePowerManagement:$false -EnableActivitySimulation:$false
```

---

## 🔗 Integration Examples

### Workflow Integration

**Before starting automation:**
```bash
# Ensure lock prevention is active
curl "https://vm-windows-1.ngrok.dev/lock-prevention/status"

# Start MCP server
curl -X POST "https://vm-windows-1.ngrok.dev/start"
```

**Before disconnecting RDP:**
```bash
# Safe disconnect
curl -X POST "https://vm-windows-1.ngrok.dev/lock-prevention/tscon"
```

**Automation monitoring:**
```bash
# Check both services
curl "https://vm-windows-1.ngrok.dev/status"           # MCP Server
curl "https://vm-windows-1.ngrok.dev/lock-prevention/status"  # Lock Prevention
```

### PowerShell Automation

```powershell
# Complete setup script
function Setup-AutomationVM {
    # Install lock prevention
    .\install-lock-prevention.ps1 -EnableActivitySimulation
    
    # Start management server
    Start-Process powershell -ArgumentList @(
        "-ExecutionPolicy", "Bypass",
        "-File", "windows_service_endpoint.ps1",
        "-Port", "8080"
    )
    
    # Configure ngrok
    Start-Process ngrok -ArgumentList "start", "--all", "--config", "ngrok.yml"
    
    Write-Host "✅ VM automation setup complete!"
}
```

---

## 🛡️ Security Considerations

**Important Security Notes:**

1. **Unlocked Desktop**: This system intentionally keeps the VM unlocked for automation purposes
2. **Administrator Rights**: Lock prevention requires administrator privileges to function
3. **Network Access**: HTTP endpoints provide service management capabilities
4. **Session Management**: TSCON operations affect user sessions

**Recommended Security Practices:**

- Deploy only on dedicated automation VMs
- Use private networks or VPN access
- Monitor logs for unexpected activity
- Regular security updates for the Windows VM
- Restrict HTTP endpoint access to authorized IPs

**Network Security:**
```bash
# Secure ngrok tunnel usage
# Use ngrok authentication headers
curl -H "ngrok-skip-browser-warning: true" -H "Authorization: Bearer your-token" "https://vm-windows-1.ngrok.dev/lock-prevention/status"
```

---

## 📈 Performance Impact

### Resource Usage
- **CPU**: Minimal (< 1% during monitoring)
- **Memory**: ~10-15 MB for service
- **Disk**: Log rotation configured (10MB max)
- **Network**: HTTP endpoints only

### Monitoring Frequency
- **Default**: 30-second intervals
- **Recommended**: 30-60 seconds for most use cases
- **High-frequency**: 15 seconds for critical automation

### Power Impact
- **Sleep Prevention**: System stays awake
- **Performance Plan**: High-performance mode when enabled
- **Display**: Remains active during automation

---

## 🤝 Support

For issues with the lock prevention system:

1. **Check Logs**: Review `logs\lock-prevention.log` for errors
2. **Test Components**: Use individual scripts to isolate issues
3. **Verify Prerequisites**: Ensure administrator rights and NSSM availability
4. **Monitor Status**: Use HTTP endpoints to check system state

**Common Support Commands:**
```powershell
# System diagnostic
Get-Service VMLockPrevention
nssm status VMLockPrevention
.\prevent-vm-lock.ps1 -Mode status

# Log review
Get-Content "logs\lock-prevention.log" -Tail 100
``` 