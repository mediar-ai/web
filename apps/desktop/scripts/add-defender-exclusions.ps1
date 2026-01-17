# add-defender-exclusions.ps1
# Run this script as Administrator to add Windows Defender exclusions for Mediar

Write-Host "Adding Windows Defender exclusions for Mediar..." -ForegroundColor Green

try {
    # Add installation directory exclusion
    Add-MpPreference -ExclusionPath "$env:ProgramFiles\mediar" -ErrorAction Stop
    Write-Host "✓ Added exclusion for Program Files\mediar" -ForegroundColor Green

    # Add AppData directory exclusion
    Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\mediar" -ErrorAction Stop
    Write-Host "✓ Added exclusion for AppData\Local\mediar" -ForegroundColor Green

    # Add process exclusions
    Add-MpPreference -ExclusionProcess "terminator-mcp-agent.exe" -ErrorAction Stop
    Write-Host "✓ Added exclusion for terminator-mcp-agent.exe process" -ForegroundColor Green

    Add-MpPreference -ExclusionProcess "mediar.exe" -ErrorAction Stop
    Write-Host "✓ Added exclusion for mediar.exe process" -ForegroundColor Green

    Write-Host "`nWindows Defender exclusions added successfully!" -ForegroundColor Green
    Write-Host "You may need to restart Mediar for changes to take effect." -ForegroundColor Yellow

    # Verify exclusions
    Write-Host "`nVerifying exclusions..." -ForegroundColor Cyan
    $paths = Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
    $processes = Get-MpPreference | Select-Object -ExpandProperty ExclusionProcess

    Write-Host "`nExcluded Paths:" -ForegroundColor Cyan
    $paths | Where-Object { $_ -like "*mediar*" } | ForEach-Object { Write-Host "  - $_" }

    Write-Host "`nExcluded Processes:" -ForegroundColor Cyan
    $processes | Where-Object { $_ -like "*mediar*" -or $_ -like "*terminator*" } | ForEach-Object { Write-Host "  - $_" }

} catch {
    Write-Host "Error adding Windows Defender exclusions: $_" -ForegroundColor Red
    Write-Host "`nPlease ensure you are running this script as Administrator." -ForegroundColor Yellow
    Write-Host "Right-click on PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Read-Host "`nPress Enter to exit"
