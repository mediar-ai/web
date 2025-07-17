#!/usr/bin/env powershell

<#
.SYNOPSIS
    Starts MCP Server in User Session for Desktop Automation
.DESCRIPTION
    Runs terminator-mcp-agent in the interactive user session to enable
    browser automation and desktop interaction capabilities.
.NOTES
    This script should be run in the user session, not as a Windows service.
#>

param(
    [string]$Version = "0.8.1",
    [int]$Port = 3000,
    [string]$Transport = "http",
    [string]$LogPath = "logs\mcp-user-session.log"
)

# Ensure logs directory exists
$logDir = Split-Path -Parent $LogPath
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Function to write timestamped logs
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Host $logMessage
    Add-Content -Path $LogPath -Value $logMessage
}

Write-Log "Starting MCP Server in User Session"
Write-Log "Version: $Version, Port: $Port, Transport: $Transport"

# Check if already running
$existingProcess = Get-Process -Name "terminator-mcp-agent" -ErrorAction SilentlyContinue
if ($existingProcess) {
    Write-Log "MCP Server already running (PID: $($existingProcess.Id))" "WARN"
    Write-Log "Stopping existing process..."
    $existingProcess | Stop-Process -Force
    Start-Sleep 2
}

# Check current session
$currentSession = (Get-Process -Id $PID).SessionId
Write-Log "Running in Session: $currentSession (Interactive: $($currentSession -gt 0))"

try {
    Write-Log "Starting terminator-mcp-agent@$Version..."
    
    # Start MCP server using cmd.exe to handle npx properly
    $command = "npx -y terminator-mcp-agent@$Version --port $Port --transport $Transport"
    Write-Log "Executing: $command"
    
    $processArgs = @{
        FilePath = "cmd.exe"
        ArgumentList = @("/c", $command)
        RedirectStandardOutput = "logs\mcp-stdout.log"
        RedirectStandardError = "logs\mcp-stderr.log"
        UseNewEnvironment = $false
        PassThru = $true
        WindowStyle = "Hidden"
    }
    
    $mcpProcess = Start-Process @processArgs
    Write-Log "MCP Server started successfully (PID: $($mcpProcess.Id))"
    
    # Wait a moment and verify it's running
    Start-Sleep 3
    
    # Test health endpoint
    try {
        $healthCheck = Invoke-WebRequest -Uri "http://localhost:$Port/health" -UseBasicParsing
        if ($healthCheck.StatusCode -eq 200) {
            Write-Log "Health check passed: MCP Server is responding" "SUCCESS"
        }
    } catch {
        Write-Log "Health check failed: $($_.Exception.Message)" "ERROR"
    }
    
    # Check session of MCP process
    $mcpSessionId = (Get-WmiObject Win32_Process | Where-Object {$_.ProcessId -eq $mcpProcess.Id}).SessionId
    Write-Log "MCP Server running in Session: $mcpSessionId"
    
    if ($mcpSessionId -gt 0) {
        Write-Log "✅ SUCCESS: MCP Server running in interactive session - browser automation should work!" "SUCCESS"
    } else {
        Write-Log "⚠️  WARNING: MCP Server in Session 0 - browser automation may not work" "WARN"
    }
    
    Write-Log "MCP Server startup complete. Process ID: $($mcpProcess.Id)"
    Write-Log "Connect your MCP client to: http://localhost:$Port/mcp"
    Write-Log "Health check available at: http://localhost:$Port/health"
    
} catch {
    Write-Log "Failed to start MCP Server: $($_.Exception.Message)" "ERROR"
    exit 1
}

Write-Log "Script completed successfully" 