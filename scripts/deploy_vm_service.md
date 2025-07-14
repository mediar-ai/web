# 🚀 Programmatic NSSM Service Restart - Deployment Guide

## Overview
To enable **fully programmatic** restart of your NSSM service from your backend, follow these steps:

---

## 🎯 **Step 1: Deploy PowerShell HTTP Server on Windows VM**

### **1.1 Connect to Your Windows VM**
- **RDP to**: `48.214.144.108:3389`
- **Use your Windows credentials**

### **1.2 Copy the PowerShell Script**
- Copy the file `scripts/windows_service_endpoint.ps1` to your Windows VM
- Save it as: `C:\ServiceManager\windows_service_endpoint.ps1`

### **1.3 Create Directory and Run Script**
```powershell
# Create directory
New-Item -ItemType Directory -Path "C:\ServiceManager" -Force

# Run the service manager (as Administrator)
powershell -ExecutionPolicy Bypass -File "C:\ServiceManager\windows_service_endpoint.ps1"
```

### **1.4 Configure Windows Firewall**
```powershell
# Allow port 8080 through Windows Firewall
New-NetFirewallRule -DisplayName "NSSM Service Manager" -Direction Inbound -Port 8080 -Protocol TCP -Action Allow
```

### **1.5 Test Local Access**
```powershell
# Test the endpoints locally
Invoke-WebRequest -Uri "http://localhost:8080/health"
Invoke-WebRequest -Uri "http://localhost:8080/status"
```

---

## 🎯 **Step 2: Test from Your Backend**

### **2.1 Check Service Status**
```bash
curl -s "http://localhost:3000/api/admin/manage-nssm-service" | jq .
```

### **2.2 Restart Service Programmatically**
```bash
curl -s -X POST "http://localhost:3000/api/admin/manage-nssm-service" \
  -H "Content-Type: application/json" \
  -d '{"action": "restart"}' | jq .
```

### **2.3 Test via JavaScript**
```javascript
// From your backend code
async function restartVMService() {
  const response = await fetch('/api/admin/manage-nssm-service', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restart' })
  });
  
  const result = await response.json();
  console.log('Service restart result:', result);
  return result;
}
```

---

## 🎯 **Step 3: Make It Persistent (Optional)**

### **3.1 Create Windows Service for HTTP Server**
```powershell
# Install the HTTP server as a Windows service using NSSM
$nssmPath = "C:\Users\terminatoradmin\Desktop\terminator\scripts\nssm\nssm-2.24\win64\nssm.exe"

# Install service
& $nssmPath install ServiceManager powershell.exe
& $nssmPath set ServiceManager Parameters "-ExecutionPolicy Bypass -File C:\ServiceManager\windows_service_endpoint.ps1"
& $nssmPath set ServiceManager Description "NSSM Service Management HTTP Server"
& $nssmPath set ServiceManager Start SERVICE_AUTO_START

# Start the service
& $nssmPath start ServiceManager
```

### **3.2 Verify Service**
```powershell
Get-Service ServiceManager
```

---

## 🎯 **Step 4: API Endpoints Available**

Once deployed, your backend can use these endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/manage-nssm-service` | Check VM and service status |
| `POST` | `/api/admin/manage-nssm-service` | Execute service actions |

### **Available Actions:**
- `{"action": "status"}` - Check service status
- `{"action": "restart"}` - Restart service
- `{"action": "start"}` - Start service
- `{"action": "stop"}` - Stop service
- `{"action": "health"}` - Health check

---

## 🔧 **Expected Success Response:**
```json
{
  "success": true,
  "action": "restart",
  "vm_status": "reachable",
  "service_status": {
    "success": true,
    "action": "restart",
    "message": "Service restarted successfully",
    "service_status": {
      "success": true,
      "status": "Running",
      "name": "MCPServer",
      "displayName": "MCPServer",
      "timestamp": "2025-07-14T03:30:00.000Z"
    }
  },
  "timestamp": "2025-07-14T03:30:00.000Z"
}
```

---

## 🚨 **Troubleshooting**

### **If HTTP Server Fails:**
1. Check Windows Firewall settings
2. Verify PowerShell execution policy
3. Check if port 8080 is already in use
4. Run PowerShell as Administrator

### **If Service Actions Fail:**
1. Verify NSSM service name is correct
2. Check service permissions
3. Ensure PowerShell has admin rights

---

## 🎉 **Ready to Use!**

Once deployed, you can restart your Windows VM service programmatically from your backend with a simple API call. The system will:

1. ✅ Try direct HTTP (fastest)
2. ✅ Fall back to PowerShell remoting
3. ✅ Fall back to SSH if configured
4. ✅ Provide clear error messages

**Your service restart is now fully automated!** 🚀 