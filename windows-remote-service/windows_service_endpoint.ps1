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
                
                default {
                    $responseData = @{ 
                        error = "Endpoint not found"
                        available_endpoints = @("/health", "/version", "/status", "/restart", "/start", "/stop")
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