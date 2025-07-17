# install-lock-prevention.ps1
# Installs Windows VM Lock Prevention as a service using NSSM
# Integrates with existing MCP service management system

param(
    [string]$ServiceName = "VMLockPrevention",
    [string]$DisplayName = "VM Lock Prevention Service",
    [string]$Description = "Prevents Windows VM from locking during desktop automation",
    [string]$NssmPath = "",
    [int]$CheckInterval = 30,
    [switch]$EnableTscon = $true,
    [switch]$EnablePowerManagement = $true,
    [switch]$EnableActivitySimulation = $false,
    [switch]$AutoStart = $true,
    [switch]$Uninstall = $false
)

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lockPreventionScript = Join-Path $scriptDir "prevent-vm-lock.ps1"

# Find NSSM executable (reuse logic from existing install script)
if ($NssmPath -eq "") {
    $nssmInScriptDir = Join-Path $scriptDir "nssm.exe"
    $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
    $nssmArchPath = Join-Path $scriptDir "nssm-2.24\$arch\nssm.exe"
    
    if (Test-Path $nssmInScriptDir) {
        $NssmPath = $nssmInScriptDir
    } elseif (Test-Path $nssmArchPath) {
        $NssmPath = $nssmArchPath
    } else {
        $nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
        if ($nssmCmd) {
            $NssmPath = $nssmCmd.Source
        } else {
            Write-Error "NSSM not found. Please ensure nssm.exe is in the script directory or PATH."
            exit 1
        }
    }
}

Write-Host "Using NSSM: $NssmPath"

function Test-IsElevated {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-LockPreventionService {
    Write-Host "Installing $DisplayName..."
    
    # Check if service already exists
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Host "Service $ServiceName already exists. Stopping and removing..."
        & $NssmPath stop $ServiceName
        & $NssmPath remove $ServiceName confirm
        Start-Sleep -Seconds 2
    }
    
    # Construct PowerShell command arguments
    $psArgs = @(
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", "`"$lockPreventionScript`"",
        "-Mode", "service",
        "-CheckIntervalSeconds", $CheckInterval,
        "-LogPath", "`"logs\lock-prevention.log`""
    )
    
    if ($EnableTscon) { $psArgs += "-EnableTscon" }
    if ($EnablePowerManagement) { $psArgs += "-EnablePowerManagement" }
    if ($EnableActivitySimulation) { $psArgs += "-EnableActivitySimulation" }
    $psArgs += "-Verbose"
    
    $psCommand = "powershell.exe"
    $psArgsString = $psArgs -join " "
    
    # Install service with NSSM
    Write-Host "Creating service with NSSM..."
    & $NssmPath install $ServiceName $psCommand $psArgsString
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install service with NSSM"
        exit 1
    }
    
    # Configure service settings
    & $NssmPath set $ServiceName DisplayName $DisplayName
    & $NssmPath set $ServiceName Description $Description
    & $NssmPath set $ServiceName Start SERVICE_AUTO_START
    
    # Set recovery options
    & $NssmPath set $ServiceName AppExit Default Restart
    & $NssmPath set $ServiceName AppRestartDelay 5000
    
    # Set working directory
    & $NssmPath set $ServiceName AppDirectory $scriptDir
    
    # Configure logging
    $logDir = Join-Path $scriptDir "logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    
    & $NssmPath set $ServiceName AppStdout (Join-Path $logDir "lock-prevention-stdout.log")
    & $NssmPath set $ServiceName AppStderr (Join-Path $logDir "lock-prevention-stderr.log")
    & $NssmPath set $ServiceName AppRotateFiles 1
    & $NssmPath set $ServiceName AppRotateOnline 1
    & $NssmPath set $ServiceName AppRotateSeconds 86400  # Daily rotation
    & $NssmPath set $ServiceName AppRotateBytes 10485760  # 10MB max
    
    Write-Host "✅ Service installed successfully!"
    
    if ($AutoStart) {
        Write-Host "Starting service..."
        & $NssmPath start $ServiceName
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Service started successfully!"
        } else {
            Write-Error "Failed to start service"
        }
    }
    
    # Display service information
    Write-Host ""
    Write-Host "🔒 VM Lock Prevention Service Configuration:"
    Write-Host "  Service Name: $ServiceName"
    Write-Host "  Display Name: $DisplayName"
    Write-Host "  Check Interval: $CheckInterval seconds"
    Write-Host "  TSCON Enabled: $EnableTscon"
    Write-Host "  Power Management: $EnablePowerManagement"
    Write-Host "  Activity Simulation: $EnableActivitySimulation"
    Write-Host "  Log Directory: $logDir"
    Write-Host ""
    Write-Host "Management Commands:"
    Write-Host "  Status:  nssm status $ServiceName"
    Write-Host "  Start:   nssm start $ServiceName"
    Write-Host "  Stop:    nssm stop $ServiceName"
    Write-Host "  Restart: nssm restart $ServiceName"
    Write-Host "  Remove:  nssm remove $ServiceName confirm"
}

function Uninstall-LockPreventionService {
    Write-Host "Uninstalling $DisplayName..."
    
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $existingService) {
        Write-Host "Service $ServiceName does not exist."
        return
    }
    
    # Stop and remove service
    Write-Host "Stopping service..."
    & $NssmPath stop $ServiceName
    
    Write-Host "Removing service..."
    & $NssmPath remove $ServiceName confirm
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Service uninstalled successfully!"
    } else {
        Write-Error "Failed to uninstall service"
    }
}

# Main execution
if (-not (Test-IsElevated)) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

if (-not (Test-Path $lockPreventionScript)) {
    Write-Error "Lock prevention script not found: $lockPreventionScript"
    exit 1
}

Write-Host "🔒 VM Lock Prevention Service Installer"
Write-Host "======================================"

if ($Uninstall) {
    Uninstall-LockPreventionService
} else {
    Install-LockPreventionService
}

Write-Host ""
Write-Host "Done!" 