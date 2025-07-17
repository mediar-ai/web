# safe-disconnect.ps1 - PowerShell version of safe RDP disconnect

Write-Host ""
Write-Host "=== Safe RDP Disconnection Utility ===" -ForegroundColor Green
Write-Host ""

# Check if running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and 'Run as administrator'" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Finding current RDP session..." -ForegroundColor Cyan

try {
    # Get current user sessions
    $currentUser = $env:USERNAME
    $sessions = query user 2>$null | ForEach-Object {
        if ($_ -match '^\s*(\S+)\s+(\S+)?\s+(\d+)\s+(\S+)\s+(.+)$') {
            @{
                Username = $matches[1].Trim()
                SessionName = $matches[2]
                SessionId = [int]$matches[3]
                State = $matches[4]
                IdleTime = $matches[5]
            }
        }
    }

    # Find current user's active session
    $userSession = $sessions | Where-Object { 
        $_.Username -eq $currentUser -and $_.State -eq "Active" 
    }

    if ($userSession) {
        Write-Host "Found session: User=$($userSession.Username), ID=$($userSession.SessionId), State=$($userSession.State)" -ForegroundColor White
        Write-Host ""
        Write-Host "Transferring RDP session $($userSession.SessionId) to console..." -ForegroundColor Yellow
        
        # Use TSCON to transfer session to console
        $result = & "$env:windir\System32\tscon.exe" $userSession.SessionId /dest:console 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "SUCCESS: RDP session transferred to console" -ForegroundColor Green
            Write-Host "Your remote desktop connection will close, but:" -ForegroundColor White
            Write-Host "  - All programs will continue running" -ForegroundColor Green
            Write-Host "  - Desktop automation will work normally" -ForegroundColor Green
            Write-Host "  - VM will remain unlocked" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "ERROR: Failed to transfer session to console" -ForegroundColor Red
            Write-Host "Result: $result" -ForegroundColor Gray
        }
    } else {
        Write-Host "ERROR: Could not find active session for user $currentUser" -ForegroundColor Red
        Write-Host "Make sure you are logged in via RDP" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Available sessions:" -ForegroundColor Gray
        $sessions | ForEach-Object {
            Write-Host "  $($_.Username) - Session $($_.SessionId) - $($_.State)" -ForegroundColor Gray
        }
    }
}
catch {
    Write-Host "ERROR: Failed to query sessions: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Press Enter to close..." -ForegroundColor Yellow
Read-Host 