# Windows Automation Agent Startup Script
param(
    [string]$AgentId = $env:AGENT_ID,
    [string]$McpPort = $env:MCP_PORT,
    [string]$TerminatorPath = $env:TERMINATOR_PATH
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Windows Automation Agent Starting" -ForegroundColor Cyan
Write-Host "Agent ID: $AgentId" -ForegroundColor Green
Write-Host "MCP Port: $McpPort" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# Create necessary directories
$directories = @(
    "C:\logs",
    "C:\temp",
    "C:\screenshots",
    "C:\workspace"
)

foreach ($dir in $directories) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "Created directory: $dir" -ForegroundColor Yellow
    }
}

# Set environment variables
$env:NODE_ENV = "production"
$env:AGENT_ID = $AgentId
$env:MCP_MODE = "http-only"
$env:ENABLE_SCREEN_CAPTURE = "true"

# Function to check if a process is running
function Test-ProcessRunning {
    param([string]$ProcessName)
    return (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue) -ne $null
}

# Function to ensure Windows UI is available
function Initialize-WindowsUI {
    Write-Host "Initializing Windows UI components..." -ForegroundColor Yellow
    
    # Start essential Windows services
    $services = @(
        "Themes",           # Windows themes service
        "AudioSrv",         # Windows Audio (some apps require it)
        "FontCache"         # Font cache service
    )
    
    foreach ($service in $services) {
        try {
            $svc = Get-Service -Name $service -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -ne 'Running') {
                Start-Service -Name $service -ErrorAction SilentlyContinue
                Write-Host "Started service: $service" -ForegroundColor Green
            }
        } catch {
            Write-Host "Could not start service: $service" -ForegroundColor Red
        }
    }
    
    # Enable UI Automation
    try {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class UIAutomation {
    [DllImport("user32.dll")]
    public static extern bool SystemParametersInfo(int uAction, int uParam, ref int lpvParam, int fuWinIni);
    
    public static void EnableUIAutomation() {
        int SPI_SETSCREENREADER = 0x0047;
        int enabled = 1;
        SystemParametersInfo(SPI_SETSCREENREADER, enabled, ref enabled, 0);
    }
}
"@
        [UIAutomation]::EnableUIAutomation()
        Write-Host "UI Automation enabled" -ForegroundColor Green
    } catch {
        Write-Host "Warning: Could not enable UI Automation programmatically" -ForegroundColor Yellow
    }
}

# Function to start the MCP server
function Start-MCPServer {
    Write-Host "Starting MCP server..." -ForegroundColor Yellow
    
    $mcpServerPath = "C:\mcp-server"
    Set-Location $mcpServerPath
    
    # Install dependencies if needed
    if (!(Test-Path "node_modules")) {
        Write-Host "Installing MCP server dependencies..." -ForegroundColor Yellow
        & npm install
    }
    
    # Build if needed
    if (!(Test-Path "dist")) {
        Write-Host "Building MCP server..." -ForegroundColor Yellow
        & npm run build
    }
    
    # Start the server
    $mcpProcess = Start-Process -FilePath "node" -ArgumentList "dist/index.js" -PassThru -NoNewWindow
    
    # Wait for server to be ready
    $maxRetries = 30
    $retryCount = 0
    while ($retryCount -lt $maxRetries) {
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$McpPort/health" -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Host "MCP server is ready!" -ForegroundColor Green
                return $mcpProcess
            }
        } catch {
            Write-Host "Waiting for MCP server to start... ($retryCount/$maxRetries)" -ForegroundColor Yellow
            Start-Sleep -Seconds 2
            $retryCount++
        }
    }
    
    throw "MCP server failed to start within timeout"
}

# Function to monitor and restart services if needed
function Start-HealthMonitor {
    param($McpProcess)
    
    while ($true) {
        # Check MCP server health
        try {
            $response = Invoke-WebRequest -Uri "http://localhost:$McpPort/health" -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ne 200) {
                throw "Health check returned non-200 status"
            }
        } catch {
            Write-Host "MCP server health check failed, restarting..." -ForegroundColor Red
            if ($McpProcess) {
                Stop-Process -Id $McpProcess.Id -Force -ErrorAction SilentlyContinue
            }
            $McpProcess = Start-MCPServer
        }
        
        # Log agent status
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $status = @{
            timestamp = $timestamp
            agent_id = $AgentId
            mcp_healthy = $true
            memory_usage_mb = (Get-Process -Id $PID).WorkingSet64 / 1MB
        }
        $status | ConvertTo-Json -Compress | Out-File -FilePath "C:\logs\agent-status.json" -Encoding UTF8
        
        # Sleep before next check
        Start-Sleep -Seconds 30
    }
}

# Main execution
try {
    # Initialize Windows UI
    Initialize-WindowsUI
    
    # Start MCP server
    $mcpProcess = Start-MCPServer
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Agent started successfully!" -ForegroundColor Green
    Write-Host "MCP endpoint: http://localhost:$McpPort/mcp" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    
    # Start health monitoring (this will run indefinitely)
    Start-HealthMonitor -McpProcess $mcpProcess
    
} catch {
    Write-Host "Fatal error during startup: $_" -ForegroundColor Red
    Write-Host $_.Exception.ToString() -ForegroundColor Red
    
    # Log error
    $errorInfo = @{
        timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        agent_id = $AgentId
        error = $_.Exception.Message
        stack_trace = $_.Exception.StackTrace
    }
    $errorInfo | ConvertTo-Json | Out-File -FilePath "C:\logs\startup-error.json" -Encoding UTF8
    
    # Exit with error code
    exit 1
}