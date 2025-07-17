# install-final.ps1 - Final clean installation

Write-Host "Installing VM Lock Prevention Service..." -ForegroundColor Green

$ServiceName = "VMLockPreventionClean"  # Different name to avoid deletion conflict
$DisplayName = "VM Lock Prevention Service"

# Install and start service
$scriptPath = Join-Path (Get-Location) "prevent-vm-lock-clean.ps1"
$psArgs = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -Mode service -CheckIntervalSeconds 30 -EnableTscon -EnablePowerManagement -Verbose"

Write-Host "Installing service $ServiceName..." -ForegroundColor Cyan
& "nssm-2.24\win64\nssm.exe" install $ServiceName powershell.exe $psArgs
& "nssm-2.24\win64\nssm.exe" set $ServiceName DisplayName $DisplayName
& "nssm-2.24\win64\nssm.exe" set $ServiceName Start SERVICE_AUTO_START

# Create logs directory
New-Item -ItemType Directory -Path "logs" -Force | Out-Null

Write-Host "Starting service..." -ForegroundColor Green
& "nssm-2.24\win64\nssm.exe" start $ServiceName

Write-Host "Service installed and started!" -ForegroundColor Green
Write-Host "Service name: $ServiceName" -ForegroundColor Yellow 