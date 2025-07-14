# Simple PowerShell HTTP server for NSSM service management
# Deploy this script on your Windows VM at 48.214.144.108
# Usage: Run this script as Administrator on the Windows VM

param(
    [int]$Port = 8080,
    [string]$ServiceName = "MCPServer"
)

Write-Host "Starting NSSM Service Management Server on port $Port"
Write-Host "Managing service: $ServiceName"

# Create HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")

try {
    $listener.Start()
    Write-Host "Server started! Listening on http://localhost:$Port"
    Write-Host "Available endpoints:"
    Write-Host "  GET  /status   - Check service status"
    Write-Host "  POST /restart  - Restart service"
    Write-Host "  POST /start    - Start service"
    Write-Host "  POST /stop     - Stop service"
    Write-Host "  POST /upgrade  - Upgrade to latest version"
    Write-Host "  GET  /health   - Server health check"
    Write-Host "  GET  /version  - Get server version info"
    
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
                        # Get service configuration from NSSM
                        $nssmPath = "C:\Users\terminatoradmin\Desktop\terminator\scripts\nssm\nssm-2.24\win64\nssm.exe"
                        $serviceApp = & $nssmPath get $ServiceName Application 2>$null
                        $serviceParams = & $nssmPath get $ServiceName AppParameters 2>$null
                        
                        # Clean up NSSM output (remove null characters and extra whitespace)
                        if ($serviceApp) {
                            $serviceApp = $serviceApp -replace '\x00', '' -replace '\s+', ' '
                            $serviceApp = $serviceApp.Trim()
                        }
                        if ($serviceParams) {
                            $serviceParams = $serviceParams -replace '\x00', '' -replace '\s+', ' '
                            $serviceParams = $serviceParams.Trim()
                        }
                        
                        # Determine deployment method and version
                        $deploymentMethod = "unknown"
                        $currentVersion = "unknown"
                        $serviceCommand = "unknown"
                        
                        if ($serviceApp -and $serviceParams) {
                            $serviceCommand = "$serviceApp $serviceParams"
                            
                            if ($serviceApp.EndsWith("npx.cmd") -or $serviceApp.EndsWith("npx")) {
                                $deploymentMethod = "NPX"
                                
                                # Extract version from NPX command (e.g., "terminator-mcp-agent@0.8.0")
                                $versionMatch = [regex]::Match($serviceParams, 'terminator-mcp-agent@([\d\.]+)')
                                if ($versionMatch.Success) {
                                    $currentVersion = $versionMatch.Groups[1].Value
                                } else {
                                    # If no version specified, it's using latest
                                    $currentVersion = "latest"
                                }
                            } else {
                                $deploymentMethod = "Local Binary"
                                
                                # Try to get version from the binary itself
                                try {
                                    $versionOutput = & $serviceApp --version 2>$null
                                    if ($versionOutput -match 'terminator-mcp-agent ([\d\.]+)') {
                                        $currentVersion = $matches[1]
                                    }
                                } catch {
                                    $currentVersion = "unknown"
                                }
                            }
                        }
                        
                        # Get latest available version from npm
                        $latestVersion = "unknown"
                        try {
                            $latestVersion = (npm view terminator-mcp-agent version 2>$null).Trim()
                        } catch {
                            $latestVersion = "error retrieving"
                        }
                        
                        # Get Git commit hash (from the management server repo)
                        $gitCommit = try { git rev-parse --short HEAD 2>$null } catch { "unknown" }
                        
                        # Check if service is running
                        $serviceStatus = "unknown"
                        try {
                            $service = Get-Service $ServiceName -ErrorAction SilentlyContinue
                            $serviceStatus = if ($service) { $service.Status.ToString() } else { "not found" }
                        } catch {
                            $serviceStatus = "error"
                        }
                        
                        # Determine update availability
                        $updateAvailable = $false
                        if ($currentVersion -ne "unknown" -and $latestVersion -ne "unknown" -and $latestVersion -ne "error retrieving") {
                            $updateAvailable = $currentVersion -ne $latestVersion
                        }
                        
                        $responseData = @{
                            success = $true
                            service = $ServiceName
                            server = "NSSM Service Manager"
                            deployment_method = $deploymentMethod
                            current_version = $currentVersion
                            latest_version = $latestVersion
                            update_available = $updateAvailable
                            service_status = $serviceStatus
                            service_command = $serviceCommand
                            git_commit = $gitCommit
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
                        $service = Get-Service $ServiceName -ErrorAction Stop
                        $responseData = @{
                            success = $true
                            status = $service.Status.ToString()
                            name = $service.Name
                            displayName = $service.DisplayName
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
                            Restart-Service $ServiceName -ErrorAction Stop
                            Start-Sleep -Seconds 2
                            $service = Get-Service $ServiceName
                            $responseData = @{
                                success = $true
                                action = "restart"
                                message = "Service restarted successfully"
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
                
                "/start" {
                    if ($method -eq "POST") {
                        try {
                            Start-Service $ServiceName -ErrorAction Stop
                            Start-Sleep -Seconds 2
                            $service = Get-Service $ServiceName
                            $responseData = @{
                                success = $true
                                action = "start"
                                message = "Service started successfully"
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
                            Stop-Service $ServiceName -ErrorAction Stop
                            Start-Sleep -Seconds 2
                            $service = Get-Service $ServiceName
                            $responseData = @{
                                success = $true
                                action = "stop"
                                message = "Service stopped successfully"
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
                
                "/upgrade" {
                    if ($method -eq "POST") {
                        try {
                            $responseData = @{
                                success = $true
                                action = "upgrade"
                                steps = @()
                                timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                            }
                            
                            # Step 1: Get latest version info
                            Write-Host "Getting latest version info..."
                            try {
                                $latestVersion = (npm view terminator-mcp-agent version 2>$null).Trim()
                                $responseData.steps += "Latest version: $latestVersion"
                                Write-Host "Latest version: $latestVersion"
                            } catch {
                                throw "Failed to get latest version info"
                            }
                            
                            # Step 2: Test NPX functionality
                            Write-Host "Testing NPX functionality..."
                            try {
                                $npxPath = Get-Command npx.cmd -ErrorAction SilentlyContinue
                                if (-not $npxPath) {
                                    $npxPath = Get-Command npx -ErrorAction SilentlyContinue
                                }
                                if (-not $npxPath) {
                                    throw "NPX not found in PATH"
                                }
                                $responseData.steps += "NPX found at: $($npxPath.Path)"
                                Write-Host "NPX found at: $($npxPath.Path)"
                            } catch {
                                throw "NPX is not available: $($_.Exception.Message)"
                            }
                            
                            # Step 3: Stop the service
                            Write-Host "Stopping service..."
                            Stop-Service $ServiceName -ErrorAction Stop
                            $responseData.steps += "Service stopped"
                            Start-Sleep -Seconds 2
                            
                            # Step 4: Clear NPX cache to ensure fresh download
                            Write-Host "Clearing NPX cache..."
                            try {
                                $cacheResult = & npm cache clean --force 2>&1
                                $responseData.steps += "NPM cache cleared"
                            } catch {
                                $responseData.steps += "NPM cache clear failed (continuing anyway)"
                            }
                            
                            try {
                                if (Get-Command npx -ErrorAction SilentlyContinue) {
                                    $npxResult = & npx clear-npx-cache 2>&1
                                    $responseData.steps += "NPX cache cleared"
                                }
                            } catch {
                                $responseData.steps += "NPX cache clear failed (continuing anyway)"
                            }
                            
                            # Step 5: Update service to use NPX with specific version
                            Write-Host "Updating service configuration to use NPX..."
                            $nssmPath = "C:\Users\terminatoradmin\Desktop\terminator\scripts\nssm\nssm-2.24\win64\nssm.exe"
                            
                            # Configure service to use NPX with specific version
                            & $nssmPath set $ServiceName Application $npxPath.Path
                            & $nssmPath set $ServiceName AppParameters "-y terminator-mcp-agent@$latestVersion --port 3000 --transport http"
                            
                            $responseData.steps += "Service configured to use NPX with version $latestVersion"
                            Write-Host "Service configured to use NPX with version $latestVersion"
                            
                            # Step 6: Start the service
                            Write-Host "Starting service with NPX..."
                            Start-Service $ServiceName -ErrorAction Stop
                            $responseData.steps += "Service started with NPX version $latestVersion"
                            Start-Sleep -Seconds 3
                            
                            # Step 7: Verify service is running
                            $service = Get-Service $ServiceName
                            if ($service.Status -eq "Running") {
                                $responseData.steps += "Service successfully running with NPX"
                                Write-Host "Service successfully running with NPX"
                            } else {
                                throw "Service failed to start properly"
                            }
                            
                            # Step 8: Get final status
                            $responseData.message = "Service upgraded successfully to NPX version $latestVersion"
                            $responseData.service_status = @{
                                status = $service.Status.ToString()
                                name = $service.Name
                            }
                            $responseData.current_version = $latestVersion
                            $responseData.deployment_method = "NPX"
                            $responseData.npx_command = "npx terminator-mcp-agent@$latestVersion --port 3000 --transport http"
                            $responseData.steps += "Upgrade completed successfully"
                            
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
                
                default {
                    $responseData = @{ 
                        error = "Endpoint not found"
                        available_endpoints = @("/health", "/version", "/status", "/restart", "/start", "/stop", "/upgrade")
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