# install-simple.ps1 - Simple lock prevention installer

Write-Host "Installing VM Lock Prevention Service..." -ForegroundColor Green
Write-Host ""

$ServiceName = "VMLockPrevention"
$DisplayName = "VM Lock Prevention Service"
$Description = "Prevents Windows VM from locking during desktop automation"

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

# Find NSSM
$nssmPath = ""
if (Test-Path "nssm.exe") {
    $nssmPath = "nssm.exe"
} elseif (Test-Path "nssm-2.24\win64\nssm.exe") {
    $nssmPath = "nssm-2.24\win64\nssm.exe"
} elseif (Test-Path "nssm-2.24\win32\nssm.exe") {
    $nssmPath = "nssm-2.24\win32\nssm.exe"
} else {
    Write-Error "NSSM not found"
    exit 1
}

Write-Host "Using NSSM: $nssmPath" -ForegroundColor Cyan

# Check if prevent-vm-lock.ps1 exists
if (-not (Test-Path "prevent-vm-lock.ps1")) {
    Write-Error "prevent-vm-lock.ps1 not found"
    exit 1
}

# Remove existing service if it exists
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Removing existing service..." -ForegroundColor Yellow
    & $nssmPath stop $ServiceName
    & $nssmPath remove $ServiceName confirm
    Start-Sleep -Seconds 2
}

# Install new service
Write-Host "Installing service..." -ForegroundColor Cyan

$scriptPath = Join-Path (Get-Location) "prevent-vm-lock.ps1"
$psArgs = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Mode service -CheckIntervalSeconds 30 -EnableTscon -EnablePowerManagement -Verbose"

& $nssmPath install $ServiceName powershell.exe $psArgs

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install service"
    exit 1
}

# Configure service
& $nssmPath set $ServiceName DisplayName $DisplayName
& $nssmPath set $ServiceName Description $Description
& $nssmPath set $ServiceName Start SERVICE_AUTO_START
& $nssmPath set $ServiceName AppExit Default Restart
& $nssmPath set $ServiceName AppRestartDelay 5000

# Create logs directory
$logDir = "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Configure logging
& $nssmPath set $ServiceName AppStdout "logs\lock-prevention-stdout.log"
& $nssmPath set $ServiceName AppStderr "logs\lock-prevention-stderr.log"
& $nssmPath set $ServiceName AppRotateFiles 1
& $nssmPath set $ServiceName AppRotateOnline 1

Write-Host "Service installed successfully!" -ForegroundColor Green

# Start service
Write-Host "Starting service..." -ForegroundColor Cyan
& $nssmPath start $ServiceName

if ($LASTEXITCODE -eq 0) {
    Write-Host "Service started successfully!" -ForegroundColor Green
} else {
    Write-Warning "Service installed but failed to start. Check logs."
}

Write-Host ""
Write-Host "Service Management Commands:" -ForegroundColor Yellow
Write-Host "  Status:  nssm status $ServiceName"
Write-Host "  Start:   nssm start $ServiceName"
Write-Host "  Stop:    nssm stop $ServiceName"
Write-Host "  Restart: nssm restart $ServiceName"
Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green 