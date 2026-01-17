# Setup script for new dev workspace clones
# Usage: .\scripts\setup-dev-workspace.ps1 [-Variant dev2]

param(
    [string]$Variant = "dev2"
)

Write-Host "Setting up workspace for $Variant variant..." -ForegroundColor Cyan

# Set environment variable for this workspace
Write-Host "Setting MEDIAR_WORKSPACE_VARIANT to $Variant..."
[Environment]::SetEnvironmentVariable("MEDIAR_WORKSPACE_VARIANT", $Variant, "User")

# Apply the smudge filter to get dev values
Write-Host "Applying $Variant values to tauri.conf.json..."
$env:MEDIAR_WORKSPACE_VARIANT = $Variant
Get-Content src-tauri/tauri.conf.json | node scripts/git-filters/tauri-config-smudge.cjs | Set-Content src-tauri/tauri.conf.json.tmp
Move-Item -Force src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json

# Mark file as assume-unchanged so it doesn't show as modified
Write-Host "Marking tauri.conf.json as assume-unchanged..."
git update-index --assume-unchanged src-tauri/tauri.conf.json

# Create post-checkout hook if it doesn't exist
$hookPath = ".git/hooks/post-checkout"
if (-not (Test-Path $hookPath)) {
    Write-Host "Creating post-checkout hook..."
    @'
#!/bin/sh
# Auto-fix tauri.conf.json after checkout
git update-index --assume-unchanged src-tauri/tauri.conf.json 2>/dev/null || true
'@ | Set-Content $hookPath
    # Note: chmod not needed on Windows
}

Write-Host "✅ Workspace setup complete!" -ForegroundColor Green
Write-Host "   - Environment variable set: MEDIAR_WORKSPACE_VARIANT=$Variant"
Write-Host "   - tauri.conf.json has $Variant values"
Write-Host "   - File marked as assume-unchanged (won't show as modified)"
Write-Host "   - Post-checkout hook installed (auto-fixes after branch switches)"