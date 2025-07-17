# test-lock-prevention.ps1
# Comprehensive test script for Windows VM Lock Prevention system
# Verifies all components are installed and working correctly

param(
    [switch]$Verbose = $false,
    [switch]$TestTscon = $false,
    [switch]$TestHTTPEndpoints = $false
)

function Write-TestResult {
    param([string]$Test, [bool]$Success, [string]$Message = "", [string]$Fix = "")
    
    $status = if ($Success) { "✅ PASS" } else { "❌ FAIL" }
    $color = if ($Success) { "Green" } else { "Red" }
    
    Write-Host "  $status $Test" -ForegroundColor $color
    if ($Message) {
        Write-Host "      $Message" -ForegroundColor Gray
    }
    if (-not $Success -and $Fix) {
        Write-Host "      Fix: $Fix" -ForegroundColor Yellow
    }
}

function Test-IsElevated {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "🔒 Windows VM Lock Prevention Test Suite" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 1. Prerequisites Tests
Write-Host "1. PREREQUISITES" -ForegroundColor Cyan
Write-Host "---------------" -ForegroundColor Cyan

$isElevated = Test-IsElevated
Write-TestResult "Administrator Rights" $isElevated "Required for lock prevention operations" "Run PowerShell as Administrator"

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

$nssmAvailable = $nssmPath -ne ""
Write-TestResult "NSSM Available" $nssmAvailable "Path: $nssmPath" "Download and extract nssm.exe to script directory"

Write-Host ""

# 2. File Tests
Write-Host "2. REQUIRED FILES" -ForegroundColor Cyan
Write-Host "----------------" -ForegroundColor Cyan

$requiredFiles = @(
    "prevent-vm-lock.ps1",
    "install-lock-prevention.ps1", 
    "rdp-disconnect-safe.bat",
    "windows_service_endpoint.ps1"
)

foreach ($file in $requiredFiles) {
    $exists = Test-Path $file
    Write-TestResult "File: $file" $exists "" "Run the installation again"
}

Write-Host ""

# 3. Service Tests
Write-Host "3. SERVICES" -ForegroundColor Cyan
Write-Host "----------" -ForegroundColor Cyan

$lockService = Get-Service -Name "VMLockPrevention" -ErrorAction SilentlyContinue
$serviceInstalled = $lockService -ne $null
Write-TestResult "Lock Prevention Service Installed" $serviceInstalled "" "Run: .\install-lock-prevention.ps1"

if ($serviceInstalled) {
    $serviceRunning = $lockService.Status -eq "Running"
    Write-TestResult "Lock Prevention Service Running" $serviceRunning "Status: $($lockService.Status)" "Run: nssm start VMLockPrevention"
}

$mcpService = Get-Service -Name "MCPServer" -ErrorAction SilentlyContinue
$mcpInstalled = $mcpService -ne $null
Write-TestResult "MCP Server Service Installed" $mcpInstalled "" "Run: .\install-mcp-service-nssm.ps1"

if ($mcpInstalled) {
    $mcpRunning = $mcpService.Status -eq "Running"
    Write-TestResult "MCP Server Service Running" $mcpRunning "Status: $($mcpService.Status)" "Run: nssm start MCPServer"
}

Write-Host ""

# 4. Directory and Log Tests
Write-Host "4. DIRECTORIES & LOGS" -ForegroundColor Cyan
Write-Host "--------------------" -ForegroundColor Cyan

$logDir = "logs"
$logDirExists = Test-Path $logDir
Write-TestResult "Log Directory Exists" $logDirExists "Path: $logDir" "Directory will be created automatically"

if ($logDirExists) {
    $lockLogFile = "logs\lock-prevention.log"
    $lockLogExists = Test-Path $lockLogFile
    Write-TestResult "Lock Prevention Log File" $lockLogExists "Path: $lockLogFile" "Logs appear after service starts"
}

Write-Host ""

# 5. Script Functionality Tests
Write-Host "5. SCRIPT FUNCTIONALITY" -ForegroundColor Cyan
Write-Host "----------------------" -ForegroundColor Cyan

try {
    $statusResult = & powershell -ExecutionPolicy Bypass -File "prevent-vm-lock.ps1" -Mode "status" 2>$null
    $statusWorks = $LASTEXITCODE -eq 0 -or $statusResult
    Write-TestResult "Status Script Execution" $statusWorks "" "Check script permissions and syntax"
    
    if ($statusWorks -and $statusResult) {
        try {
            $statusJson = $statusResult | ConvertFrom-Json
            $jsonParseable = $true
            Write-TestResult "Status JSON Parsing" $jsonParseable "Successfully parsed status response" ""
            
            if ($Verbose) {
                Write-Host "      Status Details:" -ForegroundColor Gray
                Write-Host "        TSCON Enabled: $($statusJson.TsconEnabled)" -ForegroundColor Gray
                Write-Host "        Power Management: $($statusJson.PowerManagementEnabled)" -ForegroundColor Gray
                Write-Host "        Activity Simulation: $($statusJson.ActivitySimulationEnabled)" -ForegroundColor Gray
                Write-Host "        Is Elevated: $($statusJson.IsElevated)" -ForegroundColor Gray
                Write-Host "        Sessions: $($statusJson.CurrentSessions.Count)" -ForegroundColor Gray
            }
        } catch {
            Write-TestResult "Status JSON Parsing" $false "Failed to parse JSON response" "Check script output format"
        }
    }
} catch {
    Write-TestResult "Status Script Execution" $false "Script execution failed: $($_.Exception.Message)" "Check PowerShell execution policy"
}

Write-Host ""

# 6. HTTP Endpoint Tests (Optional)
if ($TestHTTPEndpoints) {
    Write-Host "6. HTTP ENDPOINTS" -ForegroundColor Cyan
    Write-Host "----------------" -ForegroundColor Cyan
    
    $httpHealth = "http://localhost:8080/health"
    try {
        $healthResponse = Invoke-RestMethod -Uri $httpHealth -TimeoutSec 5
        Write-TestResult "HTTP Management Server" $true "Server responding on port 8080" ""
    } catch {
        Write-TestResult "HTTP Management Server" $false "Server not responding: $($_.Exception.Message)" "Start: .\windows_service_endpoint.ps1"
    }
    
    $lockEndpoint = "http://localhost:8080/lock-prevention/status"
    try {
        $lockResponse = Invoke-RestMethod -Uri $lockEndpoint -TimeoutSec 5
        $lockEndpointWorks = $lockResponse.success -eq $true
        Write-TestResult "Lock Prevention Endpoint" $lockEndpointWorks "" "Check if HTTP server includes lock prevention updates"
    } catch {
        Write-TestResult "Lock Prevention Endpoint" $false "Endpoint not available: $($_.Exception.Message)" "Update windows_service_endpoint.ps1 with lock prevention code"
    }
    
    Write-Host ""
}

# 7. TSCON Tests (Optional)
if ($TestTscon -and $isElevated) {
    Write-Host "7. TSCON FUNCTIONALITY" -ForegroundColor Cyan
    Write-Host "---------------------" -ForegroundColor Cyan
    
    try {
        $sessions = query user 2>$null
        $sessionExists = $sessions -ne $null -and $sessions.Count -gt 0
        Write-TestResult "User Sessions Available" $sessionExists "Found user sessions" "Ensure you're logged in via RDP"
        
        if ($sessionExists) {
            # Test TSCON availability (don't actually execute)
            $tsconPath = "$env:windir\System32\tscon.exe"
            $tsconExists = Test-Path $tsconPath
            Write-TestResult "TSCON Utility Available" $tsconExists "Path: $tsconPath" "TSCON should be available on all Windows versions"
            
            if ($Verbose) {
                Write-Host "      Current Sessions:" -ForegroundColor Gray
                foreach ($line in $sessions) {
                    if ($line -and $line.Trim() -ne "") {
                        Write-Host "        $line" -ForegroundColor Gray
                    }
                }
            }
        }
    } catch {
        Write-TestResult "Session Query" $false "Failed to query sessions: $($_.Exception.Message)" "Check user permissions"
    }
    
    Write-Host ""
}

# 8. Power Management Tests
Write-Host "8. POWER MANAGEMENT" -ForegroundColor Cyan
Write-Host "------------------" -ForegroundColor Cyan

try {
    $powerScheme = & powercfg /getactivescheme 2>$null
    $powerConfigWorks = $LASTEXITCODE -eq 0
    Write-TestResult "Power Configuration Access" $powerConfigWorks "" "Check administrator rights"
    
    if ($powerConfigWorks -and $powerScheme) {
        $isHighPerf = $powerScheme -match "High performance|Ultimate Performance"
        Write-TestResult "High Performance Power Plan" $isHighPerf "Current: $($powerScheme.Split(':')[1].Trim())" "Lock prevention will configure this automatically"
    }
} catch {
    Write-TestResult "Power Configuration Access" $false "Failed to access power configuration: $($_.Exception.Message)" "Run as Administrator"
}

Write-Host ""

# Summary
Write-Host "9. SUMMARY" -ForegroundColor Cyan
Write-Host "---------" -ForegroundColor Cyan

$criticalTests = @(
    $isElevated,
    $nssmAvailable,
    (Test-Path "prevent-vm-lock.ps1"),
    (Test-Path "install-lock-prevention.ps1")
)

$allCriticalPass = $criticalTests -notcontains $false
$readyToInstall = $allCriticalPass -and -not $serviceInstalled
$readyToTest = $allCriticalPass -and $serviceInstalled

if ($readyToInstall) {
    Write-Host "✅ Ready for Installation" -ForegroundColor Green
    Write-Host "   Run: .\install-lock-prevention.ps1" -ForegroundColor Yellow
} elseif ($readyToTest) {
    Write-Host "✅ Installation Complete" -ForegroundColor Green
    Write-Host "   System ready for lock prevention!" -ForegroundColor Yellow
} else {
    Write-Host "⚠️  Issues Found" -ForegroundColor Red
    Write-Host "   Address the failed tests above before proceeding" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Next Steps:" -ForegroundColor White
Write-Host "  1. Address any failed tests" -ForegroundColor Gray
Write-Host "  2. Install/start lock prevention service" -ForegroundColor Gray
Write-Host "  3. Test with: .\test-lock-prevention.ps1 -TestHTTPEndpoints" -ForegroundColor Gray
Write-Host "  4. Use .\rdp-disconnect-safe.bat before disconnecting RDP" -ForegroundColor Gray
Write-Host ""
Write-Host "For detailed setup instructions, see: LOCK_PREVENTION_SETUP.md" -ForegroundColor Yellow