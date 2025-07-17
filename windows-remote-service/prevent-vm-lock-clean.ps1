# prevent-vm-lock-clean.ps1
# Windows VM Lock Prevention Utility for Desktop Automation
# Prevents VM from locking when RDP sessions are disconnected

param(
    [string]$Mode = "interactive",  # interactive, service, tscon-only, status
    [int]$CheckIntervalSeconds = 30,
    [string]$LogPath = "logs\lock-prevention.log",
    [switch]$EnableTscon = $true,
    [switch]$EnablePowerManagement = $true,
    [switch]$EnableActivitySimulation = $false,
    [switch]$Verbose = $false
)

# Ensure logs directory exists
$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-LogMessage {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    if ($Verbose -or $Level -eq "ERROR") {
        Write-Host $logMessage
    }
    
    Add-Content -Path $LogPath -Value $logMessage
}

function Test-IsElevated {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-CurrentSessionInfo {
    try {
        $sessions = query user 2>$null | ForEach-Object {
            if ($_ -match '^\s*(\S+)\s+(\S+)?\s+(\d+)\s+(\S+)\s+(.+)$') {
                @{
                    Username = $matches[1]
                    SessionName = $matches[2]
                    SessionId = [int]$matches[3]
                    State = $matches[4]
                    IdleTime = $matches[5]
                }
            }
        }
        return $sessions | Where-Object { $_.Username -ne "SESSIONNAME" }
    }
    catch {
        Write-LogMessage "Failed to get session info: $($_.Exception.Message)" "ERROR"
        return @()
    }
}

function Invoke-TsconPrevention {
    try {
        $sessions = Get-CurrentSessionInfo
        $currentUser = $env:USERNAME
        
        Write-LogMessage "Checking sessions for user: $currentUser"
        
        # Find disconnected sessions for current user
        $disconnectedSessions = $sessions | Where-Object { 
            $_.Username -eq $currentUser -and $_.State -eq "Disc" 
        }
        
        foreach ($session in $disconnectedSessions) {
            Write-LogMessage "Found disconnected session: ID=$($session.SessionId), User=$($session.Username)"
            
            # Use TSCON to attach session to console
            $result = & "$env:windir\System32\tscon.exe" $session.SessionId /dest:console 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-LogMessage "Successfully reconnected session $($session.SessionId) to console"
                return $true
            } else {
                Write-LogMessage "Failed to reconnect session $($session.SessionId): $result" "ERROR"
            }
        }
        
        return $false
    }
    catch {
        Write-LogMessage "TSCON operation failed: $($_.Exception.Message)" "ERROR"
        return $false
    }
}

function Set-PowerManagementSettings {
    if (-not $EnablePowerManagement) {
        return
    }
    
    try {
        Write-LogMessage "Configuring power management settings for automation"
        
        # Disable sleep/hibernation for automation
        & powercfg -change -standby-timeout-ac 0 2>$null
        & powercfg -change -hibernate-timeout-ac 0 2>$null
        & powercfg -change -monitor-timeout-ac 0 2>$null
        & powercfg -change -disk-timeout-ac 0 2>$null
        
        Write-LogMessage "Power management configured for automation"
    }
    catch {
        Write-LogMessage "Failed to configure power management: $($_.Exception.Message)" "ERROR"
    }
}

function Start-ActivitySimulation {
    if (-not $EnableActivitySimulation) {
        return
    }
    
    try {
        # Prevent system from sleeping by indicating system is required
        Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices;
            
            public class PowerManagement {
                [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
                public static extern uint SetThreadExecutionState(uint esFlags);
                
                public const uint ES_CONTINUOUS = 0x80000000;
                public const uint ES_SYSTEM_REQUIRED = 0x00000001;
                public const uint ES_DISPLAY_REQUIRED = 0x00000002;
            }
"@
        
        # Keep system and display awake
        $result = [PowerManagement]::SetThreadExecutionState(
            [PowerManagement]::ES_CONTINUOUS -bor 
            [PowerManagement]::ES_SYSTEM_REQUIRED -bor 
            [PowerManagement]::ES_DISPLAY_REQUIRED
        )
        
        if ($result -ne 0) {
            Write-LogMessage "Activity simulation enabled - system will stay awake"
        } else {
            Write-LogMessage "Failed to enable activity simulation" "ERROR"
        }
    }
    catch {
        Write-LogMessage "Failed to start activity simulation: $($_.Exception.Message)" "ERROR"
    }
}

function Test-LockPreventionStatus {
    $status = @{
        TsconEnabled = $EnableTscon
        PowerManagementEnabled = $EnablePowerManagement
        ActivitySimulationEnabled = $EnableActivitySimulation
        IsElevated = Test-IsElevated
        CurrentSessions = Get-CurrentSessionInfo
        Timestamp = Get-Date
    }
    
    return $status
}

function Start-LockPreventionService {
    Write-LogMessage "Starting Lock Prevention Service (Mode: $Mode)"
    
    if (-not (Test-IsElevated)) {
        Write-LogMessage "WARNING: Not running as administrator. Some features may not work properly." "ERROR"
    }
    
    # Initial setup
    Set-PowerManagementSettings
    Start-ActivitySimulation
    
    # Main monitoring loop
    while ($true) {
        try {
            if ($EnableTscon) {
                $sessionFixed = Invoke-TsconPrevention
                if ($sessionFixed) {
                    Write-LogMessage "Session reconnected - desktop automation should continue normally"
                }
            }
            
            if ($Mode -eq "tscon-only") {
                # For one-time TSCON operation
                break
            }
            
            Start-Sleep -Seconds $CheckIntervalSeconds
        }
        catch {
            Write-LogMessage "Error in main loop: $($_.Exception.Message)" "ERROR"
            Start-Sleep -Seconds $CheckIntervalSeconds
        }
    }
}

# Main execution
switch ($Mode.ToLower()) {
    "interactive" {
        Write-Host "Windows VM Lock Prevention Utility" -ForegroundColor Green
        Write-Host "==================================" -ForegroundColor Green
        Write-Host "Mode: Interactive" -ForegroundColor Cyan
        Write-Host "TSCON Enabled: $EnableTscon" -ForegroundColor White
        Write-Host "Power Management: $EnablePowerManagement" -ForegroundColor White
        Write-Host "Activity Simulation: $EnableActivitySimulation" -ForegroundColor White
        Write-Host "Check Interval: $CheckIntervalSeconds seconds" -ForegroundColor White
        Write-Host "Log Path: $LogPath" -ForegroundColor White
        Write-Host ""
        Write-Host "Press Ctrl+C to stop..." -ForegroundColor Yellow
        Write-Host ""
        
        Start-LockPreventionService
    }
    
    "service" {
        # Running as Windows service
        Start-LockPreventionService
    }
    
    "tscon-only" {
        # One-time TSCON operation
        Write-LogMessage "Performing one-time TSCON operation"
        $result = Invoke-TsconPrevention
        if ($result) {
            Write-LogMessage "TSCON operation completed successfully"
            exit 0
        } else {
            Write-LogMessage "TSCON operation completed - no action needed"
            exit 1
        }
    }
    
    "status" {
        # Return status information
        $status = Test-LockPreventionStatus
        $status | ConvertTo-Json -Depth 3
    }
    
    default {
        Write-Host "Invalid mode: $Mode" -ForegroundColor Red
        Write-Host "Valid modes: interactive, service, tscon-only, status" -ForegroundColor Yellow
        exit 1
    }
} 