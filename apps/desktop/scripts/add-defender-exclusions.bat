@echo off
echo ==========================================
echo  Mediar - Windows Defender Exclusion Tool
echo ==========================================
echo.
echo This script will add Windows Defender exclusions for Mediar.
echo You must run this as Administrator.
echo.
echo Press any key to continue or close this window to cancel...
pause >nul

powershell.exe -ExecutionPolicy Bypass -File "%~dp0add-defender-exclusions.ps1"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Successfully added Windows Defender exclusions!
    echo You may need to restart Mediar for changes to take effect.
) else (
    echo.
    echo Failed to add exclusions. Please ensure you're running as Administrator.
    echo Right-click on this file and select "Run as administrator"
)

echo.
echo Press any key to exit...
pause >nul
