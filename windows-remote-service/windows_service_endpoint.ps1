# Simple PowerShell HTTP server for NSSM service management
# Deploy this script on your Windows VM at 48.214.144.108
# Usage: Run this script as Administrator on the Windows VM

param(
    [int]$Port = 8080,
    [string]$ServiceName = "MCPServer",
    [string]$LockPreventionServiceName = "VMLockPrevention"
)

Write-Host "Starting NSSM Service Management Server on port $Port"
Write-Host "Managing service: $ServiceName"
Write-Host "Lock prevention service: $LockPreventionServiceName"

# User session MCP management functions
function Get-MCPUserSessionStatus {
    try {
        $mcpProcess = Get-Process -Name "terminator-mcp-agent" -ErrorAction SilentlyContinue
        if ($mcpProcess) {
            $sessionInfo = Get-WmiObject Win32_Process | Where-Object {$_.ProcessId -eq $mcpProcess.Id} | Select-Object SessionId
            $isInteractive = $sessionInfo.SessionId -gt 0
            
            # Test health endpoint
            $healthStatus = "Unknown"
            try {
                $healthCheck = Invoke-WebRequest -Uri "http://localhost:3000/health" -UseBasicParsing -TimeoutSec 5
                $healthStatus = if ($healthCheck.StatusCode -eq 200) { "Healthy" } else { "Unhealthy" }
            } catch {
                $healthStatus = "Unreachable"
            }
            
            return @{
                status = "Running"
                process_id = $mcpProcess.Id
                session_id = $sessionInfo.SessionId
                interactive = $isInteractive
                health = $healthStatus
                start_time = $mcpProcess.StartTime
                cpu_time = $mcpProcess.TotalProcessorTime.TotalSeconds
                working_set = [math]::Round($mcpProcess.WorkingSet / 1MB, 2)
            }
        } else {
            return @{
                status = "Stopped"
                process_id = $null
                session_id = $null
                interactive = $false
                health = "Not Running"
            }
        }
    } catch {
        return @{
            status = "Error"
            error = $_.Exception.Message
        }
    }
}

function Start-MCPUserSession {
    param([string]$Version = "0.8.1", [int]$Port = 3000)
    
    try {
        # Check if already running
        $existing = Get-Process -Name "terminator-mcp-agent" -ErrorAction SilentlyContinue
        if ($existing) {
            return @{
                success = $false
                message = "MCP Server already running (PID: $($existing.Id))"
                process_id = $existing.Id
            }
        }
        
        # Start MCP server directly using cmd.exe (same approach as user session script)
        $command = "npx -y terminator-mcp-agent@$Version --port $Port --transport http"
        
        $processArgs = @{
            FilePath = "cmd.exe"
            ArgumentList = @("/c", $command)
            WindowStyle = "Hidden"
            PassThru = $true
        }
        
        $mcpProcess = Start-Process @processArgs
        
        # Wait a moment for startup
        Start-Sleep 5
        
        # Verify it started by checking for any terminator process
        $newProcess = Get-Process -Name "terminator-mcp-agent" -ErrorAction SilentlyContinue
        if ($newProcess) {
            # Get the session ID
            $sessionInfo = Get-WmiObject Win32_Process | Where-Object {$_.ProcessId -eq $newProcess.Id} | Select-Object SessionId
            return @{
                success = $true
                message = "MCP Server started successfully in user session"
                process_id = $newProcess.Id
                session_id = $sessionInfo.SessionId
            }
        } else {
            throw "Failed to start MCP Server - process not found after startup"
        }
    } catch {
        return @{
            success = $false
            message = "Failed to start MCP Server: $($_.Exception.Message)"
            error = $_.Exception.Message
        }
    }
}

function Stop-MCPUserSession {
    try {
        $mcpProcess = Get-Process -Name "terminator-mcp-agent" -ErrorAction SilentlyContinue
        if ($mcpProcess) {
            $processId = $mcpProcess.Id
            $mcpProcess | Stop-Process -Force
            Start-Sleep 2
            
            # Verify it stopped
            $stillRunning = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if (-not $stillRunning) {
                return @{
                    success = $true
                    message = "MCP Server stopped successfully"
                    process_id = $processId
                }
            } else {
                throw "Process still running after stop attempt"
            }
        } else {
            return @{
                success = $false
                message = "MCP Server is not running"
            }
        }
    } catch {
        return @{
            success = $false
            message = "Failed to stop MCP Server: $($_.Exception.Message)"
            error = $_.Exception.Message
        }
    }
}

function Restart-MCPUserSession {
    param([string]$Version = "0.8.1", [int]$Port = 3000)
    
    try {
        $steps = @()
        
        # Stop if running
        $stopResult = Stop-MCPUserSession
        $steps += "Stop: $($stopResult.message)"
        
        # Wait a moment
        Start-Sleep 2
        
        # Start with new version
        $startResult = Start-MCPUserSession -Version $Version -Port $Port
        $steps += "Start: $($startResult.message)"
        
        return @{
            success = $startResult.success
            message = "MCP Server restart completed"
            steps = $steps
            version = $Version
            process_id = $startResult.process_id
            session_id = $startResult.session_id
        }
    } catch {
        return @{
            success = $false
            message = "Failed to restart MCP Server: $($_.Exception.Message)"
            error = $_.Exception.Message
        }
    }
}

# Lock prevention helper functions
function Get-LockPreventionStatus {
    try {
        $scriptDir = $PSScriptRoot
        if (-not $scriptDir) {
            $scriptDir = Split-Path -Parent (Get-Location)
        }
        $lockScript = Join-Path $scriptDir "prevent-vm-lock-clean.ps1"
        
        if (Test-Path $lockScript) {
            $statusResult = & powershell -ExecutionPolicy Bypass -File $lockScript -Mode "status" 2>$null
            if ($statusResult) {
                return $statusResult | ConvertFrom-Json
            }
        }
        
        # Fallback: basic service status
        $lockPreventionServiceName = "VMLockPreventionClean"
        $service = Get-Service -Name $lockPreventionServiceName -ErrorAction SilentlyContinue
        if ($service) {
            # Check recent log entries
            $logPath = Join-Path $scriptDir "logs\lock-prevention.log"
            $lastActivity = "No recent activity"
            if (Test-Path $logPath) {
                $lastLogEntry = Get-Content $logPath -Tail 1
                if ($lastLogEntry) {
                    $lastActivity = $lastLogEntry
                }
            }
            
            return @{
                service_status = $service.Status.ToString()
                service_name = $service.Name
                last_activity = $lastActivity
                detailed_status = $true
            }
        } else {
            return @{
                service_status = "NotInstalled"
                service_name = $lockPreventionServiceName
                detailed_status = $false
            }
        }
    }
    catch {
        return @{
            error = $_.Exception.Message
            service_status = "Error"
        }
    }
}

function Invoke-TsconDisconnect {
    try {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $lockScript = Join-Path $scriptDir "prevent-vm-lock.ps1"
        
        if (Test-Path $lockScript) {
            $result = & powershell -ExecutionPolicy Bypass -File $lockScript -Mode "tscon-only" 2>$null
            return @{
                success = $LASTEXITCODE -eq 0
                message = if ($LASTEXITCODE -eq 0) { "TSCON operation completed successfully" } else { "No action needed or operation failed" }
            }
        } else {
            return @{
                success = $false
                error = "Lock prevention script not found"
            }
        }
    }
    catch {
        return @{
            success = $false
            error = $_.Exception.Message
        }
    }
}

# Create HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
    Write-Host "Server started! Listening on http://localhost:$Port"
    Write-Host "Available endpoints:"
    Write-Host "  GET  /status          - Check service status"
    Write-Host "  POST /restart         - Restart service"
    Write-Host "  POST /restart-version - Restart with specific version (JSON: {\"version\":\"0.8.1\"} or ?version=0.8.1)"
    Write-Host "  POST /upgrade         - Upgrade to latest version"
    Write-Host "  POST /start           - Start service"
    Write-Host "  POST /stop            - Stop service"
    Write-Host "  GET  /health          - Server health check"
    Write-Host "  GET  /version         - Get server version info"
    Write-Host ""
    Write-Host "Lock Prevention endpoints:"
    Write-Host "  GET  /lock-prevention/status   - Check lock prevention status"
    Write-Host "  POST /lock-prevention/tscon    - Execute TSCON disconnect"
    Write-Host "  POST /lock-prevention/restart  - Restart lock prevention service"
    Write-Host "  POST /lock-prevention/start    - Start lock prevention service"
    Write-Host "  POST /lock-prevention/stop     - Stop lock prevention service"
    
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response
        
        # Set CORS headers
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        
        $url = $request.Url.AbsolutePath
        $method = $request.HttpMethod
        
        Write-Host "$method $url"
        
        # Handle preflight requests
        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $responseData = @{}
        
        try {
            switch ($url) {
                "/health" {
                    $responseData = @{
                        status = "ok"
                        server = "NSSM Service Manager"
                        service = $ServiceName
                        timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                    }
                    $response.StatusCode = 200
                }
                
                "/version" {
                    try {
                        # Get version from workspace Cargo.toml
                        $cargoToml = Get-Content "Cargo.toml" -Raw
                        $versionMatch = [regex]::Match($cargoToml, 'version = "([^"]+)"')
                        $version = if ($versionMatch.Success) { $versionMatch.Groups[1].Value } else { "unknown" }
                        
                        # Get Git commit hash
                        $gitCommit = try { git rev-parse --short HEAD 2>$null } catch { "unknown" }
                        
                        # Get binary info
                        $binaryPath = "target\release\terminator-mcp-agent.exe"
                        $binaryInfo = if (Test-Path $binaryPath) {
                            $fileInfo = Get-ItemProperty $binaryPath
                            @{
                                size = $fileInfo.Length
                                build_date = $fileInfo.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                path = $binaryPath
                            }
                        } else {
                            @{
                                size = "unknown"
                                build_date = "unknown"
                                path = "not found"
                            }
                        }
                        
                        $responseData = @{
                            success = $true
                            version = $version
                            git_commit = $gitCommit
                            binary = $binaryInfo
                            service = $ServiceName
                            server = "NSSM Service Manager"
                            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                        }
                        $response.StatusCode = 200
                    } catch {
                        $responseData = @{
                            success = $false
                            error = $_.Exception.Message
                            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                        }
                        $response.StatusCode = 500
                    }
                }
                
                "/status" {
                    try {
                        $mcpStatus = Get-MCPUserSessionStatus
                        $responseData = @{
                            success = $true
                            mcp_server = $mcpStatus
                            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                        }
                        $response.StatusCode = 200
                    } catch {
                        $responseData = @{
                            success = $false
                            error = $_.Exception.Message
                            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                        }
                        $response.StatusCode = 500
                    }
                }
                
                "/restart" {
                    if ($method -eq "POST") {
                        try {
                            $restartResult = Restart-MCPUserSession
                            $responseData = @{
                                success = $restartResult.success
                                action = "restart"
                                message = $restartResult.message
                                steps = $restartResult.steps
                                mcp_server = @{
                                    process_id = $restartResult.process_id
                                    session_id = $restartResult.session_id
                                    version = $restartResult.version
                                }
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = if ($restartResult.success) { 200 } else { 500 }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "restart"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/restart-version" {
                    if ($method -eq "POST") {
                        try {
                            # Parse request body for version parameter
                            $requestBody = [System.IO.StreamReader]::new($context.Request.InputStream).ReadToEnd()
                            $version = "0.8.1"
                            
                            if ($requestBody) {
                                try {
                                    $bodyObj = $requestBody | ConvertFrom-Json
                                    if ($bodyObj.version) {
                                        $version = $bodyObj.version
                                    }
                                } catch {
                                    # If JSON parsing fails, try query string format
                                    if ($requestBody -match "version=([^&]+)") {
                                        $version = $matches[1]
                                    }
                                }
                            }
                            
                            # Also check query parameters
                            if ($context.Request.QueryString["version"]) {
                                $version = $context.Request.QueryString["version"]
                            }
                            
                            # Use user session restart with specific version
                            $restartResult = Restart-MCPUserSession -Version $version -Port 3000
                            
                            $responseData = @{
                                success = $restartResult.success
                                action = "restart-version"
                                message = "MCP Server restarted with version $version in user session"
                                version = $version
                                steps = $restartResult.steps
                                mcp_server = @{
                                    process_id = $restartResult.process_id
                                    session_id = $restartResult.session_id
                                    interactive = ($restartResult.session_id -gt 0)
                                }
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = if ($restartResult.success) { 200 } else { 500 }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "restart-version"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST with JSON body containing 'version' parameter or query parameter ?version=X.X.X" }
                        $response.StatusCode = 405
                    }
                }
                
                "/upgrade" {
                    if ($method -eq "POST") {
                        try {
                            $steps = @()
                            $nssmPath = Join-Path $PSScriptRoot "nssm-2.24\win64\nssm.exe"
                            
                            # Step 1: Stop service
                            $steps += "Stopping MCP service..."
                            & $nssmPath stop $ServiceName
                            Start-Sleep -Seconds 3
                            
                            # Step 2: Update to latest
                            $steps += "Updating to latest version..."
                            $newParams = "-y terminator-mcp-agent --port 3000 --transport http"
                            & $nssmPath set $ServiceName AppParameters $newParams
                            $steps += "Service configured for latest version"
                            
                            # Step 3: Start service
                            $steps += "Starting MCP service..."
                            & $nssmPath start $ServiceName
                            Start-Sleep -Seconds 5
                            
                            # Step 4: Verify
                            $service = Get-Service $ServiceName
                            $steps += "Service status: $($service.Status)"
                            
                            $responseData = @{
                                success = $true
                                action = "upgrade"
                                message = "Service upgraded to latest version successfully"
                                steps = $steps
                                service_status = @{
                                    status = $service.Status.ToString()
                                    name = $service.Name
                                }
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 200
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "upgrade"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/start" {
                    if ($method -eq "POST") {
                        try {
                            $startResult = Start-MCPUserSession
                            $responseData = @{
                                success = $startResult.success
                                action = "start"
                                message = $startResult.message
                                mcp_server = @{
                                    process_id = $startResult.process_id
                                    session_id = $startResult.session_id
                                    interactive = ($startResult.session_id -gt 0)
                                }
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = if ($startResult.success) { 200 } else { 500 }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "start"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/stop" {
                    if ($method -eq "POST") {
                        try {
                            $stopResult = Stop-MCPUserSession
                            $responseData = @{
                                success = $stopResult.success
                                action = "stop"
                                message = $stopResult.message
                                mcp_server = @{
                                    process_id = $stopResult.process_id
                                    status = "Stopped"
                                }
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = if ($stopResult.success) { 200 } else { 500 }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "stop"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/lock-prevention/status" {
                    if ($method -eq "GET") {
                        try {
                            $lockStatus = Get-LockPreventionStatus
                            $responseData = @{
                                success = $true
                                action = "lock-prevention-status"
                                lock_prevention = $lockStatus
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 200
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "lock-prevention-status"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use GET." }
                        $response.StatusCode = 405
                    }
                }
                
                "/lock-prevention/tscon" {
                    if ($method -eq "POST") {
                        try {
                            $tsconResult = Invoke-TsconDisconnect
                            $responseData = @{
                                success = $tsconResult.success
                                action = "tscon-disconnect"
                                message = $tsconResult.message
                                error = $tsconResult.error
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = if ($tsconResult.success) { 200 } else { 500 }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "tscon-disconnect"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/lock-prevention/restart" {
                    if ($method -eq "POST") {
                        try {
                            $service = Get-Service -Name $LockPreventionServiceName -ErrorAction SilentlyContinue
                            if ($service) {
                                Restart-Service $LockPreventionServiceName -ErrorAction Stop
                                Start-Sleep -Seconds 2
                                $service = Get-Service $LockPreventionServiceName
                                $responseData = @{
                                    success = $true
                                    action = "lock-prevention-restart"
                                    message = "Lock prevention service restarted successfully"
                                    service_status = @{
                                        status = $service.Status.ToString()
                                        name = $service.Name
                                    }
                                    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                }
                                $response.StatusCode = 200
                            } else {
                                $responseData = @{
                                    success = $false
                                    action = "lock-prevention-restart"
                                    error = "Lock prevention service not found. Install it first."
                                    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                }
                                $response.StatusCode = 404
                            }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "lock-prevention-restart"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/lock-prevention/start" {
                    if ($method -eq "POST") {
                        try {
                            $service = Get-Service -Name $LockPreventionServiceName -ErrorAction SilentlyContinue
                            if ($service) {
                                Start-Service $LockPreventionServiceName -ErrorAction Stop
                                Start-Sleep -Seconds 2
                                $service = Get-Service $LockPreventionServiceName
                                $responseData = @{
                                    success = $true
                                    action = "lock-prevention-start"
                                    message = "Lock prevention service started successfully"
                                    service_status = @{
                                        status = $service.Status.ToString()
                                        name = $service.Name
                                    }
                                    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                }
                                $response.StatusCode = 200
                            } else {
                                $responseData = @{
                                    success = $false
                                    action = "lock-prevention-start"
                                    error = "Lock prevention service not found. Install it first."
                                    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                }
                                $response.StatusCode = 404
                            }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "lock-prevention-start"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                "/lock-prevention/stop" {
                    if ($method -eq "POST") {
                        try {
                            $service = Get-Service -Name $LockPreventionServiceName -ErrorAction SilentlyContinue
                            if ($service) {
                                Stop-Service $LockPreventionServiceName -ErrorAction Stop
                                Start-Sleep -Seconds 2
                                $service = Get-Service $LockPreventionServiceName
                                $responseData = @{
                                    success = $true
                                    action = "lock-prevention-stop"
                                    message = "Lock prevention service stopped successfully"
                                    service_status = @{
                                        status = $service.Status.ToString()
                                        name = $service.Name
                                    }
                                    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                }
                                $response.StatusCode = 200
                            } else {
                                $responseData = @{
                                    success = $false
                                    action = "lock-prevention-stop"
                                    error = "Lock prevention service not found."
                                    timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                                }
                                $response.StatusCode = 404
                            }
                        } catch {
                            $responseData = @{
                                success = $false
                                action = "lock-prevention-stop"
                                error = $_.Exception.Message
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            $response.StatusCode = 500
                        }
                    } else {
                        $responseData = @{ error = "Method not allowed. Use POST." }
                        $response.StatusCode = 405
                    }
                }
                
                default {
                    $responseData = @{ 
                        error = "Endpoint not found"
                        available_endpoints = @("/health", "/version", "/status", "/restart", "/restart-version", "/upgrade", "/start", "/stop", "/lock-prevention/status", "/lock-prevention/tscon", "/lock-prevention/restart", "/lock-prevention/start", "/lock-prevention/stop")
                    }
                    $response.StatusCode = 404
                }
            }
        } catch {
            $responseData = @{
                success = $false
                error = "Internal server error: $($_.Exception.Message)"
                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
            }
            $response.StatusCode = 500
        }
        
        # Send JSON response
        $responseJson = $responseData | ConvertTo-Json -Depth 10
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
        $response.ContentType = "application/json"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
        
        Write-Host "Response sent: $($response.StatusCode)"
    }
} catch {
    Write-Host "Server error: $($_.Exception.Message)"
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    Write-Host "Server stopped"
}