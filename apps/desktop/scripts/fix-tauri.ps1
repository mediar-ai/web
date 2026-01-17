# Quick fix for tauri.conf.json showing as modified
# Just run: .\scripts\fix-tauri.ps1

Write-Host "Fixing tauri.conf.json..." -ForegroundColor Yellow
git update-index --assume-unchanged src-tauri/tauri.conf.json
Write-Host "✅ Fixed! tauri.conf.json won't show as modified anymore." -ForegroundColor Green