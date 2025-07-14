# Real-time Server Log Monitor
# Monitors all server components in one terminal window

param(
    [switch]$ShowNgrok = $true,
    [switch]$ShowMCP = $true,
    [switch]$ShowHTTP = $true,
    [int]$RefreshSeconds = 2
)

Clear-Host

Write-Host "*** Real-time Server Log Monitor ***" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""

# Log file paths
$mcpLogFile = "C:\Users\terminatoradmin\Desktop\terminator\logs\mcp-server.log"
$mcpErrorFile = "C:\Users\terminatoradmin\Desktop\terminator\logs\mcp-server-error.log"
$ngrokUrl = "http://127.0.0.1:4040/api/tunnels"
$httpHealthUrl = "http://localhost:8080/health"

# Function to display colored output
function Write-ColoredLog {
    param(
        [string]$Message,
        [string]$Color = "White",
        [string]$Prefix = ""
    )
    
    if ($Prefix) {
        Write-Host "[$Prefix] " -NoNewline -ForegroundColor $Color
    }
    Write-Host $Message -ForegroundColor $Color
}

# Function to get last N lines from file
function Get-LastLines {
    param(
        [string]$FilePath,
        [int]$Lines = 10
    )
    
    if (Test-Path $FilePath) {
        Get-Content $FilePath -Tail $Lines -ErrorAction SilentlyContinue
    } else {
        @("Log file not found: $FilePath")
    }
}

# Function to check service status
function Get-ServiceStatus {
    try {
        $service = Get-Service MCPServer -ErrorAction Stop
        return @{
            Status = $service.Status
            Name = $service.Name
            Success = $true
        }
    } catch {
        return @{
            Status = "Not Found"
            Error = $_.Exception.Message
            Success = $false
        }
    }
}

# Function to check HTTP server
function Get-HTTPServerStatus {
    try {
        $response = Invoke-WebRequest -Uri $httpHealthUrl -UseBasicParsing -TimeoutSec 3
        $json = $response.Content | ConvertFrom-Json
        return @{
            Status = "Online"
            Port = 8080
            Success = $true
            Response = $json
        }
    } catch {
        return @{
            Status = "Offline"
            Error = $_.Exception.Message
            Success = $false
        }
    }
}

# Function to check ngrok status
function Get-NgrokStatus {
    try {
        $response = Invoke-WebRequest -Uri $ngrokUrl -UseBasicParsing -TimeoutSec 3
        $json = $response.Content | ConvertFrom-Json
        return @{
            Status = "Online"
            Tunnels = $json.tunnels.Count
            Success = $true
            Data = $json
        }
    } catch {
        return @{
            Status = "Offline"
            Error = $_.Exception.Message
            Success = $false
        }
    }
}

# Main monitoring loop
try {
    Write-Host "Press Ctrl+C to stop monitoring..." -ForegroundColor Yellow
    Write-Host ""
    
    while ($true) {
        # Clear screen and show header
        Clear-Host
        Write-Host "*** Real-time Server Log Monitor - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ***" -ForegroundColor Green
        Write-Host "=====================================" -ForegroundColor Green
        Write-Host ""
        
        # 1. Service Status
        Write-Host "SERVICE STATUS" -ForegroundColor Cyan
        Write-Host "----------------" -ForegroundColor Cyan
        $serviceStatus = Get-ServiceStatus
        if ($serviceStatus.Success) {
            Write-ColoredLog "MCPServer: $($serviceStatus.Status)" -Color Green -Prefix "SERVICE"
        } else {
            Write-ColoredLog "MCPServer: $($serviceStatus.Status)" -Color Red -Prefix "SERVICE"
        }
        Write-Host ""
        
        # 2. HTTP Management Server Status
        if ($ShowHTTP) {
            Write-Host "HTTP MANAGEMENT SERVER" -ForegroundColor Cyan
            Write-Host "-------------------------" -ForegroundColor Cyan
            $httpStatus = Get-HTTPServerStatus
            if ($httpStatus.Success) {
                Write-ColoredLog "Status: $($httpStatus.Status) on port $($httpStatus.Port)" -Color Green -Prefix "HTTP"
                Write-ColoredLog "Last Health Check: $($httpStatus.Response.timestamp)" -Color White -Prefix "HTTP"
            } else {
                Write-ColoredLog "Status: $($httpStatus.Status)" -Color Red -Prefix "HTTP"
                Write-ColoredLog "Error: $($httpStatus.Error)" -Color Red -Prefix "HTTP"
            }
            Write-Host ""
        }
        
        # 3. Ngrok Status
        if ($ShowNgrok) {
            Write-Host "NGROK TUNNEL" -ForegroundColor Cyan
            Write-Host "---------------" -ForegroundColor Cyan
            $ngrokStatus = Get-NgrokStatus
            if ($ngrokStatus.Success) {
                Write-ColoredLog "Status: $($ngrokStatus.Status)" -Color Green -Prefix "NGROK"
                Write-ColoredLog "Active Tunnels: $($ngrokStatus.Tunnels)" -Color White -Prefix "NGROK"
                if ($ngrokStatus.Data.tunnels.Count -gt 0) {
                    foreach ($tunnel in $ngrokStatus.Data.tunnels) {
                        Write-ColoredLog "  -> $($tunnel.public_url) -> $($tunnel.config.addr)" -Color Yellow -Prefix "NGROK"
                    }
                }
            } else {
                Write-ColoredLog "Status: $($ngrokStatus.Status)" -Color Red -Prefix "NGROK"
                Write-ColoredLog "Error: $($ngrokStatus.Error)" -Color Red -Prefix "NGROK"
            }
            Write-Host ""
        }
        
        # 4. MCP Server Logs
        if ($ShowMCP) {
            Write-Host "MCP SERVER LOGS (Last 5 lines)" -ForegroundColor Cyan
            Write-Host "-----------------------------" -ForegroundColor Cyan
            $mcpLogs = Get-LastLines -FilePath $mcpLogFile -Lines 5
            if ($mcpLogs.Count -gt 0) {
                foreach ($line in $mcpLogs) {
                    if ($line.Trim() -ne "") {
                        Write-ColoredLog $line -Color White -Prefix "MCP"
                    }
                }
            } else {
                Write-ColoredLog "No logs yet (restart service to generate logs)" -Color Yellow -Prefix "MCP"
            }
            
            # Show errors if any
            $mcpErrors = Get-LastLines -FilePath $mcpErrorFile -Lines 3
            if ($mcpErrors.Count -gt 0) {
                Write-Host ""
                Write-Host "MCP SERVER ERRORS (Last 3 lines)" -ForegroundColor Red
                foreach ($line in $mcpErrors) {
                    if ($line.Trim() -ne "") {
                        Write-ColoredLog $line -Color Red -Prefix "ERROR"
                    }
                }
            }
            Write-Host ""
        }
        
        # 5. Recent HTTP Requests (simulated)
        Write-Host "RECENT ACTIVITY" -ForegroundColor Cyan
        Write-Host "-------------------" -ForegroundColor Cyan
        Write-ColoredLog "For detailed HTTP logs, open: http://127.0.0.1:4040" -Color Yellow -Prefix "INFO"
        Write-ColoredLog "HTTP Management Server: http://localhost:8080" -Color Yellow -Prefix "INFO"
        Write-ColoredLog "Ngrok Public URL: https://barely-honest-yak.ngrok-free.app" -Color Yellow -Prefix "INFO"
        Write-Host ""
        
        # Footer
        Write-Host "*** Refreshing every $RefreshSeconds seconds... (Ctrl+C to stop) ***" -ForegroundColor Yellow
        
        Start-Sleep -Seconds $RefreshSeconds
    }
    
} catch {
    Write-Host ""
    Write-Host "Monitoring stopped by user" -ForegroundColor Green
} finally {
    Write-Host "Log monitoring ended" -ForegroundColor Green
} 