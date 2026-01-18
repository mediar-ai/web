#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Sets up git filters for workspace-specific configurations

.DESCRIPTION
    Configures git clean/smudge filters that automatically:
    - Ensure production values are committed to repository
    - Apply workspace-specific values in local working directory

    This prevents accidental commits of dev workspace configurations.

.PARAMETER WorkspaceVariant
    Workspace variant (dev, dev2, dev3, staging, etc.)
    Leave empty or set to 'production' for production workspace

.EXAMPLE
    .\scripts\setup-git-filters.ps1 -WorkspaceVariant dev2
    Sets up filters and configures workspace as dev2

.EXAMPLE
    .\scripts\setup-git-filters.ps1
    Sets up filters for production workspace
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$WorkspaceVariant = ""
)

Write-Host "[--] Setting up git filters for tauri.conf.json..." -ForegroundColor Cyan

# Configure git filters (paths relative to repo root for monorepo)
Write-Host "  [..] Configuring clean filter (production values on commit)..." -ForegroundColor Gray
git config filter.tauri-config.clean "node apps/desktop/scripts/git-filters/tauri-config-clean.cjs"

Write-Host "  [..] Configuring smudge filter (workspace values on checkout)..." -ForegroundColor Gray
git config filter.tauri-config.smudge "node apps/desktop/scripts/git-filters/tauri-config-smudge.cjs"

# Set workspace variant environment variable if specified
if ($WorkspaceVariant -and $WorkspaceVariant -ne "production") {
    Write-Host "  [..] Setting workspace variant: $WorkspaceVariant" -ForegroundColor Gray
    [Environment]::SetEnvironmentVariable("MEDIAR_WORKSPACE_VARIANT", $WorkspaceVariant, "User")
    $env:MEDIAR_WORKSPACE_VARIANT = $WorkspaceVariant

    Write-Host ""
    Write-Host "[OK] Git filters configured for workspace: $WorkspaceVariant" -ForegroundColor Green
    Write-Host "     Production values will be committed automatically" -ForegroundColor Gray
    Write-Host "     Local working directory will use: mediar-$WorkspaceVariant" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "[OK] Git filters configured for production workspace" -ForegroundColor Green
    Write-Host "     Production values will be used everywhere" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[..] Reapplying filters to existing files..." -ForegroundColor Cyan
git checkout HEAD -- apps/desktop/src-tauri/tauri.conf.json 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Filters applied successfully!" -ForegroundColor Green
} else {
    Write-Host "[WARN] Note: Run 'git checkout HEAD -- apps/desktop/src-tauri/tauri.conf.json' to apply filters" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[INFO] Current configuration:" -ForegroundColor Cyan
git config --get-regexp 'filter\.tauri-config\..*' | ForEach-Object {
    Write-Host "       $_" -ForegroundColor Gray
}

if ($env:MEDIAR_WORKSPACE_VARIANT) {
    Write-Host "       MEDIAR_WORKSPACE_VARIANT=$env:MEDIAR_WORKSPACE_VARIANT" -ForegroundColor Gray
}
