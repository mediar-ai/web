@echo off
REM rdp-disconnect-safe.bat
REM Safe RDP disconnection using TSCON to prevent VM lock
REM Keeps desktop automation running when RDP session is disconnected

echo.
echo ========================================
echo Safe RDP Disconnection Utility
echo ========================================
echo.
echo This script will safely disconnect your RDP session
echo while keeping the desktop unlocked for automation.
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

echo Finding current RDP session...

REM Get current user session information
for /f "skip=1 tokens=1,3,4" %%i in ('query user %USERNAME% 2^>nul') do (
    set SESSION_USER=%%i
    set SESSION_ID=%%j
    set SESSION_STATE=%%k
)

if not defined SESSION_ID (
    echo ERROR: Could not find session for user %USERNAME%
    echo Make sure you are logged in via RDP
    pause
    exit /b 1
)

echo Found session: User=%SESSION_USER%, ID=%SESSION_ID%, State=%SESSION_STATE%
echo.

if "%SESSION_STATE%"=="Active" (
    echo Transferring RDP session %SESSION_ID% to console...
    
    REM Use TSCON to transfer session to console
    %windir%\System32\tscon.exe %SESSION_ID% /dest:console
    
    if !errorlevel! equ 0 (
        echo.
        echo ✅ SUCCESS: RDP session transferred to console
        echo Your remote desktop connection will close, but:
        echo - All programs will continue running
        echo - Desktop automation will work normally  
        echo - VM will remain unlocked
        echo.
    ) else (
        echo.
        echo ❌ ERROR: Failed to transfer session to console
        echo You may need to disconnect normally or try running as different user
        echo.
    )
) else (
    echo Session is not active (%SESSION_STATE%)
    echo This script should be run from an active RDP session
)

echo.
echo Press any key to close...
pause >nul 