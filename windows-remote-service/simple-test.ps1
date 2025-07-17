# simple-test.ps1 - Test lock prevention system

Write-Host "Lock Prevention Quick Test" -ForegroundColor Green
Write-Host "=========================" -ForegroundColor Green
Write-Host ""

# Check administrator rights
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Write-Host "Administrator Rights: $isAdmin" -ForegroundColor $(if($isAdmin) {"Green"} else {"Red"})

# Check required files
Write-Host "Required Files:" -ForegroundColor Cyan
$files = @("prevent-vm-lock.ps1", "install-lock-prevention.ps1", "rdp-disconnect-safe.bat")
foreach ($file in $files) {
    $exists = Test-Path $file
    $color = if($exists) {"Green"} else {"Red"}
    Write-Host "  $file : $exists" -ForegroundColor $color
}

# Check services
Write-Host ""
Write-Host "Services:" -ForegroundColor Cyan

$lockService = Get-Service -Name "VMLockPrevention" -ErrorAction SilentlyContinue
if ($lockService) {
    $color = if($lockService.Status -eq "Running") {"Green"} else {"Yellow"}
    Write-Host "  Lock Prevention: $($lockService.Status)" -ForegroundColor $color
} else {
    Write-Host "  Lock Prevention: Not Installed" -ForegroundColor Red
}

$mcpService = Get-Service -Name "MCPServer" -ErrorAction SilentlyContinue
if ($mcpService) {
    $color = if($mcpService.Status -eq "Running") {"Green"} else {"Yellow"}
    Write-Host "  MCP Server: $($mcpService.Status)" -ForegroundColor $color
} else {
    Write-Host "  MCP Server: Not Installed" -ForegroundColor Red
}

# Check NSSM
Write-Host ""
Write-Host "NSSM Availability:" -ForegroundColor Cyan
$nssmPath = ""
$nssmInScriptDir = "nssm.exe"
$arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
$nssmArchPath = "nssm-2.24\$arch\nssm.exe"

if (Test-Path $nssmInScriptDir) {
    $nssmPath = $nssmInScriptDir
} elseif (Test-Path $nssmArchPath) {
    $nssmPath = $nssmArchPath
} else {
    $nssmCmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($nssmCmd) {
        $nssmPath = $nssmCmd.Source
    }
}

if ($nssmPath) {
    Write-Host "  NSSM Found: $nssmPath" -ForegroundColor Green
} else {
    Write-Host "  NSSM: Not Found" -ForegroundColor Red
}

Write-Host ""
Write-Host "Status Summary:" -ForegroundColor Cyan
if (-not $lockService) {
    Write-Host "  Ready to install lock prevention service" -ForegroundColor Yellow
    Write-Host "  Next: Run .\install-lock-prevention.ps1" -ForegroundColor Yellow
} elseif ($lockService.Status -ne "Running") {
    Write-Host "  Service installed but not running" -ForegroundColor Yellow
    Write-Host "  Next: nssm start VMLockPrevention" -ForegroundColor Yellow
} else {
    Write-Host "  Lock prevention system is active!" -ForegroundColor Green
} 