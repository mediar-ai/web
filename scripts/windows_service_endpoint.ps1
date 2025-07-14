# Simple PowerShell HTTP server for NSSM service management
# Deploy this script on your Windows VM at 48.214.144.108
# Usage: Run this script as Administrator on the Windows VM

param(
    [int]$Port = 8080,
    [string]$ServiceName = "MCPServer"
)

Write-Host "🚀 Starting NSSM Service Management Server on port $Port"
Write-Host "Managing service: $ServiceName"

# Create HTTP listener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()

Write-Host "✅ Server started! Listening on http://localhost:$Port"
Write-Host "📋 Available endpoints:"
Write-Host "  GET  /status   - Check service status"
Write-Host "  POST /restart  - Restart service"
Write-Host "  POST /start    - Start service"
Write-Host "  POST /stop     - Stop service"
Write-Host "  GET  /health   - Server health check"

function Get-ServiceStatus($serviceName) {
    try {
        $service = Get-Service $serviceName -ErrorAction Stop
        return @{
            success = $true
            status = $service.Status.ToString()
            name = $service.Name
            displayName = $service.DisplayName
            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
    } catch {
        return @{
            success = $false
            error = $_.Exception.Message
            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
    }
}

function Invoke-ServiceAction($serviceName, $action) {
    try {
        switch ($action) {
            "start" { 
                Start-Service $serviceName -ErrorAction Stop
                $message = "Service started successfully"
            }
            "stop" { 
                Stop-Service $serviceName -ErrorAction Stop
                $message = "Service stopped successfully"
            }
            "restart" { 
                Restart-Service $serviceName -ErrorAction Stop
                $message = "Service restarted successfully"
            }
            default { 
                throw "Invalid action: $action"
            }
        }
        
        Start-Sleep -Seconds 2  # Wait for service to settle
        $status = Get-ServiceStatus $serviceName
        
        return @{
            success = $true
            action = $action
            message = $message
            service_status = $status
            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
    } catch {
        return @{
            success = $false
            action = $action
            error = $_.Exception.Message
            timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        }
    }
}

# Main server loop
try {
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
        
        Write-Host "📡 $method $url"
        
        # Handle preflight requests
        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }
        
        $responseData = @{}
        
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
            
            "/status" {
                $responseData = Get-ServiceStatus $ServiceName
                $response.StatusCode = if ($responseData.success) { 200 } else { 500 }
            }
            
            "/restart" {
                if ($method -eq "POST") {
                    $responseData = Invoke-ServiceAction $ServiceName "restart"
                    $response.StatusCode = if ($responseData.success) { 200 } else { 500 }
                } else {
                    $responseData = @{ error = "Method not allowed. Use POST." }
                    $response.StatusCode = 405
                }
            }
            
            "/start" {
                if ($method -eq "POST") {
                    $responseData = Invoke-ServiceAction $ServiceName "start"
                    $response.StatusCode = if ($responseData.success) { 200 } else { 500 }
                } else {
                    $responseData = @{ error = "Method not allowed. Use POST." }
                    $response.StatusCode = 405
                }
            }
            
            "/stop" {
                if ($method -eq "POST") {
                    $responseData = Invoke-ServiceAction $ServiceName "stop"
                    $response.StatusCode = if ($responseData.success) { 200 } else { 500 }
                } else {
                    $responseData = @{ error = "Method not allowed. Use POST." }
                    $response.StatusCode = 405
                }
            }
            
            default {
                $responseData = @{ 
                    error = "Endpoint not found"
                    available_endpoints = @("/health", "/status", "/restart", "/start", "/stop")
                }
                $response.StatusCode = 404
            }
        }
        
        # Send JSON response
        $responseJson = $responseData | ConvertTo-Json -Depth 10
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
        $response.ContentType = "application/json"
        $response.ContentLength64 = $buffer.Length
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
        
        Write-Host "✅ Response sent: $($response.StatusCode)"
    }
} catch {
    Write-Host "❌ Server error: $($_.Exception.Message)"
} finally {
    $listener.Stop()
    Write-Host "🛑 Server stopped"
} 