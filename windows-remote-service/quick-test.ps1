# quick-test.ps1 - Simple lock prevention test

Write-Host "🔒 Lock Prevention Quick Test" -ForegroundColor Green
Write-Host "============================" -ForegroundColor Green
Write-Host ""

# Check administrator rights
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "Administrator: $isAdmin" -ForegroundColor $(if($isAdmin) {"Green"} else {"Red"})

# Check files exist
$files = @("prevent-vm-lock.ps1", "install-lock-prevention.ps1", "rdp-disconnect-safe.bat")
foreach ($file in $files) {
    $exists = Test-Path $file
    Write-Host "File $file`: $exists" -ForegroundColor $(if($exists) {"Green"} else {"Red"})
}

# Check services
$lockService = Get-Service -Name "VMLockPrevention" -ErrorAction SilentlyContinue
if ($lockService) {
    Write-Host "Lock Prevention Service: $($lockService.Status)" -ForegroundColor $(if($lockService.Status -eq "Running") {"Green"} else {"Yellow"})
} else {
    Write-Host "Lock Prevention Service: Not Installed" -ForegroundColor Red
}

$mcpService = Get-Service -Name "MCPServer" -ErrorAction SilentlyContinue
if ($mcpService) {
    Write-Host "MCP Service: $($mcpService.Status)" -ForegroundColor $(if($mcpService.Status -eq "Running") {"Green"} else {"Yellow"})
} else {
    Write-Host "MCP Service: Not Installed" -ForegroundColor Red
}

Write-Host ""
if (-not $lockService) {
    Write-Host "Next step: Run .\install-lock-prevention.ps1" -ForegroundColor Yellow
} else {
    Write-Host "Lock prevention is ready!" -ForegroundColor Green
} 