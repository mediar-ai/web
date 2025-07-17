# safe-disconnect-fixed.ps1 - Fixed version that handles > prefix

Write-Host ""
Write-Host "=== Safe RDP Disconnection Utility ===" -ForegroundColor Green
Write-Host ""

Write-Host "Finding current RDP session..." -ForegroundColor Cyan

try {
    # Get current user sessions
    $currentUser = $env:USERNAME
    $sessions = query user 2>$null | ForEach-Object {
        if ($_ -match '^\s*>?(\S+)\s+(\S+)?\s+(\d+)\s+(\S+)\s+(.+)$') {
            @{
                Username = $matches[1].Trim()
                SessionName = $matches[2]
                SessionId = [int]$matches[3]
                State = $matches[4]
                IdleTime = $matches[5]
                IsCurrentSession = $_.StartsWith(' >')
            }
        }
    }

    Write-Host "Current user: $currentUser" -ForegroundColor Gray
    Write-Host "Found sessions:" -ForegroundColor Gray
    $sessions | ForEach-Object {
        $prefix = if ($_.IsCurrentSession) { " > " } else { "   " }
        Write-Host "$prefix$($_.Username) - Session $($_.SessionId) - $($_.State)" -ForegroundColor Gray
    }

    # Find current user's active session (with or without > prefix)
    $userSession = $sessions | Where-Object { 
        $_.Username -eq $currentUser -and $_.State -eq "Active" 
    }

    if ($userSession) {
        Write-Host ""
        Write-Host "Found session: User=$($userSession.Username), ID=$($userSession.SessionId), State=$($userSession.State)" -ForegroundColor White
        Write-Host ""
        Write-Host "Transferring RDP session $($userSession.SessionId) to console..." -ForegroundColor Yellow
        
        # Use TSCON to transfer session to console
        $result = & "$env:windir\System32\tscon.exe" $userSession.SessionId /dest:console 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "SUCCESS: RDP session transferred to console!" -ForegroundColor Green
            Write-Host "Your remote desktop connection will close, but:" -ForegroundColor White
            Write-Host "  - All programs will continue running" -ForegroundColor Green
            Write-Host "  - Desktop automation will work normally" -ForegroundColor Green
            Write-Host "  - VM will remain unlocked" -ForegroundColor Green
            Write-Host ""
            Write-Host "Lock prevention system is protecting your VM!" -ForegroundColor Cyan
        } else {
            Write-Host ""
            Write-Host "ERROR: Failed to transfer session to console" -ForegroundColor Red
            Write-Host "Result: $result" -ForegroundColor Gray
        }
    } else {
        Write-Host ""
        Write-Host "ERROR: Could not find active session for user $currentUser" -ForegroundColor Red
    }
}
catch {
    Write-Host "ERROR: Failed to query sessions: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Press Enter to close..." -ForegroundColor Yellow
Read-Host 