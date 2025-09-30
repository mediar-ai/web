# Health Endpoint Uptime Fix

## Problem
The admin UI shows "N/A" for uptime because the remote machine health endpoints don't return `uptime_seconds`.

## Current Health Response (from VMs)
```json
{
  "status": "healthy",
  "extension_bridge": { ... },
  "automation": { ... },
  "timestamp": "2025-09-30T20:43:30.621861700+00:00"
}
```

## Required Health Response
```json
{
  "status": "healthy",
  "uptime_seconds": 86400,  // ← ADD THIS
  "extension_bridge": { ... },
  "automation": { ... },
  "timestamp": "2025-09-30T20:43:30.621861700+00:00"
}
```

## How to Calculate Uptime on Windows (Rust)

### Option 1: Using GetTickCount64
```rust
use windows::Win32::System::SystemInformation::GetTickCount64;

fn get_uptime_seconds() -> u64 {
    unsafe {
        let uptime_ms = GetTickCount64();
        uptime_ms / 1000
    }
}
```

### Option 2: Using System Boot Time
```rust
use std::process::Command;

fn get_uptime_seconds() -> Result<u64, Box<dyn std::error::Error>> {
    let output = Command::new("wmic")
        .args(&["os", "get", "lastbootuptime"])
        .output()?;

    let output_str = String::from_utf8_lossy(&output.stdout);
    // Parse the lastbootuptime and calculate difference from now
    // Format: 20250930144530.500000+000

    // Or simpler: use systeminfo | findstr "Boot Time"
    Ok(0) // TODO: Parse and calculate
}
```

### Option 3: PowerShell (Simplest for Testing)
```powershell
# Get uptime in seconds
(Get-Date) - (gcim Win32_OperatingSystem).LastBootUpTime | Select-Object -ExpandProperty TotalSeconds
```

## Update Your Health Endpoint

In your Rust health endpoint handler, add:
```rust
#[get("/health")]
async fn health() -> impl Responder {
    let uptime_seconds = unsafe { GetTickCount64() / 1000 };

    HttpResponse::Ok().json(json!({
        "status": "healthy",
        "uptime_seconds": uptime_seconds,  // ← Add this
        "extension_bridge": get_bridge_status(),
        "automation": get_automation_status(),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}
```

## Verification

After updating the health endpoints:
1. Wait for next cron run (runs every 5 minutes)
2. Check admin page - uptime should show values like "2d 5h" instead of "-"
3. Test manually: `curl https://your-vm.cloudapp.azure.com/health | jq .uptime_seconds`

## What's Already Fixed

✅ The web app cron is now ready to capture uptime_seconds
✅ The admin UI displays uptime in human-readable format
✅ The last_health_check field will populate on next cron run

❌ The VMs need to report uptime_seconds in their health responses
