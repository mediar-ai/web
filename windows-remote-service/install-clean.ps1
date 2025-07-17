# install-clean.ps1 - Install using clean script

Write-Host "Installing VM Lock Prevention Service (Clean Version)..." -ForegroundColor Green
Write-Host ""

$ServiceName = "VMLockPrevention"
$DisplayName = "VM Lock Prevention Service"

# Find NSSM
$nssmPath = "nssm-2.24\win64\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    $nssmPath = "nssm-2.24\win32\nssm.exe"
}

Write-Host "Using NSSM: $nssmPath" -ForegroundColor Cyan

# Install service
$scriptPath = Join-Path (Get-Location) "prevent-vm-lock-clean.ps1"
$psArgs = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Mode service -CheckIntervalSeconds 30 -EnableTscon -EnablePowerManagement -Verbose"

Write-Host "Installing service..." -ForegroundColor Cyan
& $nssmPath install $ServiceName powershell.exe $psArgs

# Configure service
& $nssmPath set $ServiceName DisplayName $DisplayName
& $nssmPath set $ServiceName Start SERVICE_AUTO_START
& $nssmPath set $ServiceName AppExit Default Restart

# Create logs and configure
New-Item -ItemType Directory -Path "logs" -Force | Out-Null
& $nssmPath set $ServiceName AppStdout "logs\lock-prevention-stdout.log"
& $nssmPath set $ServiceName AppStderr "logs\lock-prevention-stderr.log"

Write-Host "Service installed! Starting..." -ForegroundColor Green

# Start service
& $nssmPath start $ServiceName

Write-Host "Done!" -ForegroundColor Green 