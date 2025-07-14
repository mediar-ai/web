<#
install-mcp-service-nssm.ps1
Installs the MCP server as a Windows service using NSSM (Non-Sucking Service Manager)

Prerequisites:
1. Download NSSM from https://nssm.cc/release/nssm-2.24.zip
2. Extract nssm.exe from the zip file (use the version matching your architecture: win32 or win64)
3. Place nssm.exe in the same directory as this script or in your PATH

Usage examples (run from an elevated PowerShell session):
# Basic usage with defaults (latest version, port 3000, http transport)
.\install-mcp-service-nssm.ps1

# Specify version
.\install-mcp-service-nssm.ps1 -Version "0.7.9"

# Specify all parameters
.\install-mcp-service-nssm.ps1 -Version "0.7.9" -Port 3001 -Transport "stdio"

# Use local executable
.\install-mcp-service-nssm.ps1 -ExecutablePath "C:\path\to\terminator-mcp-agent.exe"
#>

param(
    [string]$NssmPath = "", # Path to nssm.exe (if empty, searches in script dir and PATH)
    [string]$ExecutablePath = "", # Full path to mcp.exe (if empty, uses npx)
    [string]$Version = "latest", # Version of terminator-mcp-agent to use
    [int]$Port = 3000, # Port for HTTP transport
    [string]$Transport = "http", # Transport type: http, stdio, sse
    [string]$ServiceName = "MCPServer", # Internal service name
    [string]$DisplayName = "MCP Server", # What shows up in Services MMC
    [string]$Description = "MCP server for desktop automation"
)

# Find NSSM executable
if ($NssmPath -eq "") {
    # First check in the same directory as this script
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $nssmInScriptDir = Join-Path $scriptDir "nssm.exe"
    
    # Check for architecture-specific versions
    $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
    $nssmArchPath = Join-Path $scriptDir "nssm-2.24\$arch\nssm.exe"
    
    if (Test-Path $nssmInScriptDir) {
        $NssmPath = $nssmInScriptDir
    } elseif (Test-Path $nssmArchPath) {
        $NssmPath = $nssmArchPath
    } else {
        # Try to find in PATH
        $nssmInPath = Get-Command nssm.exe -ErrorAction SilentlyContinue
        if ($nssmInPath) {
            $NssmPath = $nssmInPath.Path
        } else {
            Write-Error "NSSM not found! Please:"
            Write-Error "1. Download from https://nssm.cc/release/nssm-2.24.zip"
            Write-Error "2. Extract nssm.exe to this script's directory or add to PATH"
            Write-Error "3. Or specify the path using -NssmPath parameter"
            exit 1
        }
    }
}

Write-Host "Using NSSM at: $NssmPath" -ForegroundColor Green

# Check if service already exists
$existingService = & $NssmPath status $ServiceName 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Service '$ServiceName' already exists. Removing..." -ForegroundColor Yellow
    & $NssmPath stop $ServiceName 2>$null
    & $NssmPath remove $ServiceName confirm
    Start-Sleep 2
}

# Determine what to run
if ($ExecutablePath -eq "") {
    # Use npx
    $npxPath = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $npxPath) {
        $npxPath = Get-Command npx -ErrorAction SilentlyContinue
    }
    if (-not $npxPath) {
        Write-Error "npx not found in PATH! Please ensure Node.js is installed."
        exit 1
    }
    
    $versionArg = if ($Version -eq "latest") { "terminator-mcp-agent" } else { "terminator-mcp-agent@$Version" }
    $application = $npxPath.Path
    $appParameters = "-y $versionArg --port $Port --transport $Transport"
    
    $Description += " (npx version: $Version, transport: $Transport, port: $Port)"
} else {
    # Use local executable
    if (-not (Test-Path $ExecutablePath)) {
        Write-Error "Executable not found at: $ExecutablePath"
        exit 1
    }
    
    $application = $ExecutablePath
    $appParameters = "--port $Port --transport $Transport"
    
    $Description += " (local executable, transport: $Transport, port: $Port)"
}

Write-Host ""
Write-Host "Installing service with NSSM..." -ForegroundColor Cyan
Write-Host "  Service Name: $ServiceName" -ForegroundColor White
Write-Host "  Display Name: $DisplayName" -ForegroundColor White
Write-Host "  Description: $Description" -ForegroundColor White
Write-Host "  Application: $application" -ForegroundColor Yellow
Write-Host "  Parameters: $appParameters" -ForegroundColor Yellow
Write-Host ""

# Install the service
& $NssmPath install $ServiceName $application $appParameters

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install service!"
    exit 1
}

# Set service properties
& $NssmPath set $ServiceName DisplayName $DisplayName
& $NssmPath set $ServiceName Description $Description
& $NssmPath set $ServiceName Start SERVICE_AUTO_START

# Set working directory
$workDir = Split-Path -Parent $application
& $NssmPath set $ServiceName AppDirectory $workDir

# Set environment variables (ensure Node.js is in PATH)
& $NssmPath set $ServiceName AppEnvironmentExtra "PATH=%PATH%;C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\npm"

# Configure automatic restart on failure
& $NssmPath set $ServiceName AppThrottle 5000 # Wait 5 seconds before restart
& $NssmPath set $ServiceName AppExit Default Restart # Restart on normal exit
& $NssmPath set $ServiceName AppRestartDelay 5000 # 5 second delay

# Configure logging
$logDir = "C:\Logs\MCPServer"
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
& $NssmPath set $ServiceName AppStdout "$logDir\service.log"
& $NssmPath set $ServiceName AppStderr "$logDir\error.log"
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 1048576 # 1MB

Write-Host "Starting service..." -ForegroundColor Green
& $NssmPath start $ServiceName

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Service '$ServiceName' installed and started successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Service Management Commands:" -ForegroundColor Cyan
    Write-Host "  Status:  nssm status $ServiceName" -ForegroundColor White
    Write-Host "  Stop:    nssm stop $ServiceName" -ForegroundColor White
    Write-Host "  Start:   nssm start $ServiceName" -ForegroundColor White
    Write-Host "  Restart: nssm restart $ServiceName" -ForegroundColor White
    Write-Host "  Remove:  nssm remove $ServiceName confirm" -ForegroundColor White
    Write-Host ""
    Write-Host "Logs are saved to: $logDir" -ForegroundColor White
    
    if ($Transport -eq "http") {
        Write-Host "MCP endpoint: http://localhost:$Port/mcp" -ForegroundColor Green
        Write-Host "Health check: http://localhost:$Port/health" -ForegroundColor Green
    }
} else {
    Write-Host "❌ Failed to start service. Check logs at: $logDir" -ForegroundColor Red
}

Write-Host ""
Write-Host "To view service configuration:" -ForegroundColor Cyan
Write-Host "  nssm edit $ServiceName" -ForegroundColor White 