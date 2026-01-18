# Mediar Safe Restart Script - Ultra-conservative approach
# Uses process command line and window titles to identify Mediar processes

param(
    [switch]$NoDebug,
    [switch]$Verbose,
    [switch]$UseCratesIO,  # Use published crates.io versions instead of local terminator
    [int]$PreferredPort = 1420,  # Default port, but will auto-increment if taken
    [string]$WebAppUrl = ""  # Optional web app URL for local backend testing (e.g., http://localhost:3002)
)

# Get the current workspace directory name (e.g., "mediar-app_3")
$WORKSPACE_NAME = Split-Path -Leaf (Get-Location)

# Map workspace name to dev identifier (needed early for cache cleanup)
# In monorepo, we're in apps/desktop, so check parent workspace folder name
$monorepoRoot = Split-Path -Parent (Split-Path -Parent (Get-Location))
$monorepoName = Split-Path -Leaf $monorepoRoot
$devNumber = switch ($monorepoName) {
    "mediar-web-app-workspace"   { "1" }
    "mediar-web-app-workspace_2" { "2" }
    "mediar-web-app-workspace_3" { "3" }
    "mediar-web-app-workspace_4" { "4" }
    default        { "1" }  # Default to dev1 for unknown workspaces
}

# Create logs directory if it doesn't exist
if (!(Test-Path logs)) {
    New-Item -ItemType Directory -Force -Path logs | Out-Null
}

Write-Host "=== Mediar Safe Restart ===" -ForegroundColor Cyan
Write-Host "Workspace: $WORKSPACE_NAME" -ForegroundColor Cyan
"=== SAFE RESTART START $(Get-Date) ===" | Out-File logs\debug.log

# Function to check if a port is available
function Test-PortAvailable {
    param([int]$Port)

    try {
        $tcpConnections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($tcpConnections) {
            return $false
        }
    } catch {
        # If Get-NetTCPConnection fails, try netstat
        $netstatOutput = netstat -an | Select-String ":$Port\s" | Select-String "LISTENING"
        if ($netstatOutput) {
            return $false
        }
    }

    return $true
}

# Function to find an available port starting from a preferred port
function Find-AvailablePort {
    param(
        [int]$StartPort = 1420,
        [int]$MaxAttempts = 100
    )

    Write-Host "Checking port availability starting from $StartPort..." -ForegroundColor Yellow

    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $port = $StartPort + $i
        if (Test-PortAvailable -Port $port) {
            Write-Host "  [OK] Port $port is available!" -ForegroundColor Green
            return $port
        } else {
            if ($Verbose) {
                Write-Host "  [--] Port $port is in use" -ForegroundColor Gray
            }
        }
    }

    throw "Could not find an available port in range $StartPort-$($StartPort + $MaxAttempts)"
}

# Function to get process using a specific port
function Get-ProcessUsingPort {
    param([int]$Port)

    try {
        $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($connection) {
            $process = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
            if ($process) {
                return @{
                    ProcessName = $process.Name
                    ProcessId = $process.Id
                    ProcessPath = $process.Path
                }
            }
        }
    } catch {
        # Fallback to netstat if PowerShell cmdlets fail
        $netstatOutput = netstat -ano | Select-String ":$Port\s.*LISTENING\s+(\d+)$"
        if ($netstatOutput -match "\s(\d+)$") {
            $pid = $Matches[1]
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                return @{
                    ProcessName = $process.Name
                    ProcessId = $process.Id
                    ProcessPath = $process.Path
                }
            }
        }
    }

    return $null
}

# Function to safely identify and kill Mediar processes
function Stop-MediarProcess {
    param(
        [string]$ProcessName,
        [string]$PathPattern
    )

    $processes = Get-WmiObject Win32_Process | Where-Object {
        $_.Name -eq "$ProcessName.exe" -and
        ($_.CommandLine -like "*\$PathPattern\*" -or $_.CommandLine -like "*/$PathPattern/*")
    }

    foreach ($proc in $processes) {
        if ($Verbose) {
            Write-Host "  Found: $($proc.Name) with command: $($proc.CommandLine.Substring(0, [Math]::Min(100, $proc.CommandLine.Length)))..." -ForegroundColor Gray
        }
        Write-Host "  Stopping: $($proc.Name) (PID: $($proc.ProcessId))" -ForegroundColor Red
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        "Killed $($proc.Name) (PID: $($proc.ProcessId))" | Out-File -Append logs\debug.log
    }
}

Write-Host "Looking for $WORKSPACE_NAME processes..." -ForegroundColor Yellow

# Kill cargo processes running in the current workspace directory
Stop-MediarProcess -ProcessName "cargo" -PathPattern $WORKSPACE_NAME

# Kill mediar.exe from current workspace
Stop-MediarProcess -ProcessName "mediar" -PathPattern $WORKSPACE_NAME

# Kill terminator-mcp-agent.exe from current workspace
Stop-MediarProcess -ProcessName "terminator-mcp-agent" -PathPattern $WORKSPACE_NAME

# Kill node/bun processes running in current workspace directory
Stop-MediarProcess -ProcessName "node" -PathPattern $WORKSPACE_NAME
Stop-MediarProcess -ProcessName "bun" -PathPattern $WORKSPACE_NAME

# Find and kill Vite process by checking for vite in the command line
$viteProcesses = Get-WmiObject Win32_Process | Where-Object {
    ($_.Name -eq "node.exe" -or $_.Name -eq "bun.exe") -and
    $_.CommandLine -like "*vite*" -and
    ($_.CommandLine -like "*\$WORKSPACE_NAME\*" -or $_.CommandLine -like "*/$WORKSPACE_NAME/*")
}

foreach ($proc in $viteProcesses) {
    Write-Host "  Stopping Vite server (PID: $($proc.ProcessId))" -ForegroundColor Red
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
    "Killed Vite process (PID: $($proc.ProcessId))" | Out-File -Append logs\debug.log
}

# Small delay to ensure processes are fully terminated
Start-Sleep -Seconds 2

# Check if node_modules exists, install if missing
if (!(Test-Path "node_modules")) {
    Write-Host "node_modules not found, installing dependencies..." -ForegroundColor Yellow
    # Skip prepare script (husky) which fails on Windows
    npm install --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: npm install failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Dependencies installed successfully" -ForegroundColor Green
} else {
    Write-Host "Dependencies already installed, skipping npm install" -ForegroundColor Gray
}

# Build MCP if build script exists (only if needed)
if (Test-Path "scripts\build-mcp.js") {
    Write-Host "Checking MCP build status..." -ForegroundColor Yellow
    # Check if MCP binary exists and is recent
    $mcpPath = ".\terminator-mcp-agent.exe"
    $needsMcpBuild = $true

    if (Test-Path $mcpPath) {
        $mcpAge = (Get-Date) - (Get-Item $mcpPath).LastWriteTime
        if ($mcpAge.TotalMinutes -lt 5) {
            Write-Host "  MCP binary is recent (built ${mcpAge.TotalMinutes:N1} minutes ago), skipping rebuild" -ForegroundColor Gray
            $needsMcpBuild = $false
        }
    }

    if ($needsMcpBuild) {
        Write-Host "Building MCP..." -ForegroundColor Yellow
        bun scripts\build-mcp.js --local
    }
    
    Write-Host ""
    $terminatorRoot = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) "..\..\..\terminator"))
    Write-Host "[build-mcp] MCP Server Source: $terminatorRoot\terminator-mcp-agent" -ForegroundColor Cyan
    Write-Host "[build-mcp] MCP Binary From: $env:LOCALAPPDATA\mediar\bin\terminator-mcp-agent.exe" -ForegroundColor Cyan
    Write-Host "[build-mcp] Terminator Recorder Source: $terminatorRoot\crates\terminator-workflow-recorder" -ForegroundColor Cyan
    Write-Host "[build-mcp] Terminator-rs Source: $terminatorRoot\crates\terminator" -ForegroundColor Cyan
}

# Ensure local terminator config exists for development
Write-Host "`n=== Terminator Source Configuration ===" -ForegroundColor Cyan

# Check if we should use crates.io (for testing production behavior locally)
if ($UseCratesIO -or $env:USE_CRATES_IO -eq "true") {
    if (Test-Path "src-tauri\.cargo\config.toml") {
        Remove-Item "src-tauri\.cargo\config.toml" -Force
        Write-Host "Removed local config - using PUBLISHED crates.io versions" -ForegroundColor Yellow
    } else {
        Write-Host "Using PUBLISHED crates.io versions" -ForegroundColor Yellow
    }
} else {
    # Normal dev mode - ensure local terminator config exists
    if (!(Test-Path "src-tauri\.cargo\config.toml")) {
        Write-Host "Local terminator config not found, creating it..." -ForegroundColor Yellow

        # Create .cargo directory if it doesn't exist
        if (!(Test-Path "src-tauri\.cargo")) {
            New-Item -ItemType Directory -Force -Path "src-tauri\.cargo" | Out-Null
        }

        # Create config.toml with local terminator paths (relative to src-tauri/.cargo/)
        $configContent = @"
# Cargo configuration for mediar development
#
# This file patches terminator dependencies to use local sources during development.
# Git ignores this file, so it won't affect production builds.
#
# To temporarily use crates.io versions, run:
#   `$env:USE_CRATES_IO = "true"; .\restart-dev-safe.ps1

[patch.crates-io]
terminator-workflow-recorder = { path = "../../../../terminator/crates/terminator-workflow-recorder" }
terminator-rs = { path = "../../../../terminator/crates/terminator" }
"@
        $configContent | Set-Content "src-tauri\.cargo\config.toml" -Encoding UTF8
        Write-Host "Created local terminator config" -ForegroundColor Green

        # Need to update Cargo.lock to use local sources
        Write-Host "Updating Cargo.lock to use local sources..." -ForegroundColor Yellow
        Set-Location src-tauri
        cargo update -p terminator-workflow-recorder -p terminator-rs 2>&1 | Out-Null
        Set-Location ..
    }

    Write-Host "Using LOCAL terminator sources (auto-configured)" -ForegroundColor Green
    # Get the actual path from cargo
    Set-Location src-tauri
    $pkgId = cargo pkgid terminator-workflow-recorder 2>$null
    if ($pkgId -and ($pkgId -match 'path\+file:///(.+)#')) {
        $terminatorPath = $Matches[1] -replace '/', '\'
        Write-Host "  Path: $terminatorPath" -ForegroundColor Gray
    }
    Set-Location ..
}


# Link local npm packages for TypeScript workflows (similar to Cargo patches for Rust)
function Update-WorkflowLocalPackages {
    $workflowsDir = "$env:LOCALAPPDATA\mediar\workflows"
    $localPackages = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) "..\..\..\terminator\packages"))

    if (!(Test-Path $workflowsDir)) {
        Write-Host "No workflows directory found, skipping npm package linking" -ForegroundColor Gray
        return
    }

    if (!(Test-Path $localPackages)) {
        Write-Host "Local terminator packages not found at $localPackages" -ForegroundColor Yellow
        return
    }

    $linkedCount = 0
    Get-ChildItem $workflowsDir -Directory | ForEach-Object {
        $targetDir = Join-Path $_.FullName "node_modules\@mediar-ai"

        if (Test-Path $targetDir) {
            # Link terminator-nodejs as @mediar-ai/terminator
            $terminatorTarget = Join-Path $targetDir "terminator"
            $terminatorSource = Join-Path $localPackages "terminator-nodejs"

            if ((Test-Path $terminatorTarget) -and (Test-Path $terminatorSource)) {
                # Check if it's already a junction to the right place
                $item = Get-Item $terminatorTarget -Force
                if ($item.LinkType -ne "Junction" -or $item.Target -ne $terminatorSource) {
                    Remove-Item $terminatorTarget -Recurse -Force -ErrorAction SilentlyContinue
                    cmd /c mklink /J "$terminatorTarget" "$terminatorSource" 2>$null | Out-Null
                    $linkedCount++
                }
            }

            # Link workflow package as @mediar-ai/workflow
            $workflowTarget = Join-Path $targetDir "workflow"
            $workflowSource = Join-Path $localPackages "workflow"

            if ((Test-Path $workflowTarget) -and (Test-Path $workflowSource)) {
                $item = Get-Item $workflowTarget -Force
                if ($item.LinkType -ne "Junction" -or $item.Target -ne $workflowSource) {
                    Remove-Item $workflowTarget -Recurse -Force -ErrorAction SilentlyContinue
                    cmd /c mklink /J "$workflowTarget" "$workflowSource" 2>$null | Out-Null
                    $linkedCount++
                }
            }
        }
    }

    if ($linkedCount -gt 0) {
        Write-Host "Linked $linkedCount local npm packages to workflows" -ForegroundColor Green
    } else {
        Write-Host "Local npm packages already linked (or no workflows need linking)" -ForegroundColor Gray
    }
}

# Run the local package linking (unless using crates.io mode)
if (!$UseCratesIO -and $env:USE_CRATES_IO -ne "true") {
    Write-Host "`n=== TypeScript Workflow Package Linking ===" -ForegroundColor Cyan
    Update-WorkflowLocalPackages
}

# Note: Rust build is handled by `tauri dev` below
# In monorepo, running cargo directly from src-tauri causes workspace conflicts
# The shared target directory at workspace root can have lock contention issues
Write-Host "`nRust backend will be built by tauri dev..." -ForegroundColor Yellow
"=== RUST BUILD DEFERRED TO TAURI DEV $(Get-Date) ===" | Out-File -Append logs\debug.log

# Frontend build is usually handled by Vite's HMR, only check for TypeScript errors
Write-Host "Checking TypeScript compilation..." -ForegroundColor Yellow
"=== CHECKING TYPESCRIPT $(Get-Date) ===" | Out-File -Append logs\debug.log
bun run typecheck 2>&1 | Out-File -Append logs\debug.log
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: TypeScript has compilation errors, but continuing..." -ForegroundColor Yellow
} else {
    Write-Host "[OK] TypeScript check passed" -ForegroundColor Green
}

# Clear Vite caches to ensure fresh builds
Write-Host "`nCleaning Vite caches..." -ForegroundColor Yellow
$viteCachePaths = @('.vite', 'node_modules\.vite')
foreach ($cachePath in $viteCachePaths) {
    if (Test-Path $cachePath) {
        Remove-Item -Recurse -Force $cachePath -ErrorAction SilentlyContinue
        Write-Host "  Removed $cachePath" -ForegroundColor Green
    } else {
        if ($Verbose) {
            Write-Host "  $cachePath does not exist, skipping" -ForegroundColor Gray
        }
    }
}

# Clear Tauri WebView cache for development app
Write-Host "`nCleaning Tauri WebView cache..." -ForegroundColor Yellow
$tauriCachePath = "$env:LOCALAPPDATA\ai.mediar.desktop.dev$devNumber\EBWebView"
if (Test-Path $tauriCachePath) {
    Remove-Item -Recurse -Force $tauriCachePath -ErrorAction SilentlyContinue
    Write-Host "  Removed Tauri WebView cache" -ForegroundColor Green
} else {
    if ($Verbose) {
        Write-Host "  Tauri WebView cache does not exist, skipping" -ForegroundColor Gray
    }
}

# Auto-detect available port
Write-Host "`n=== Port Configuration ===" -ForegroundColor Cyan
$selectedPort = $PreferredPort

if (!(Test-PortAvailable -Port $PreferredPort)) {
    Write-Host "[WARN] Port $PreferredPort is currently in use!" -ForegroundColor Yellow

    # Show what's using the port
    $blockingProcess = Get-ProcessUsingPort -Port $PreferredPort
    if ($blockingProcess) {
        Write-Host "  Process using port $PreferredPort`: $($blockingProcess.ProcessName) (PID: $($blockingProcess.ProcessId))" -ForegroundColor Yellow
        if ($blockingProcess.ProcessPath) {
            Write-Host "  Path: $($blockingProcess.ProcessPath)" -ForegroundColor Gray
        }
    }

    # Find an alternative port
    Write-Host "`nSearching for an available port..." -ForegroundColor Yellow
    $selectedPort = Find-AvailablePort -StartPort $PreferredPort
}

Write-Host "`n🚀 Starting Mediar on port $selectedPort" -ForegroundColor Green

# Set debug logging if not disabled
if (!$NoDebug) {
    $env:RUST_LOG = "terminator_mcp_agent=debug,terminator=debug,info"
    Write-Host "Debug logging enabled" -ForegroundColor Green
}

# Update environment variables for Vite to use the selected port
$env:VITE_PORT = $selectedPort
$env:PORT = $selectedPort

# Read API URL from .env file if it exists
$apiUrlFromEnv = $null
if (Test-Path ".env") {
    $envContent = Get-Content ".env" | Where-Object { $_ -match "^VITE_API_BASE_URL=" }
    if ($envContent) {
        $apiUrlFromEnv = $envContent -replace "^VITE_API_BASE_URL=", ""
        $apiUrlFromEnv = $apiUrlFromEnv.Trim('"').Trim("'")  # Remove quotes if present
    }
}

# Set API URL with priority: 1. Command line parameter, 2. .env file, 3. Default
Write-Host "`n=== Backend Configuration ===" -ForegroundColor Cyan
if ($WebAppUrl) {
    # Use command line parameter (highest priority)
    $env:VITE_API_BASE_URL = $WebAppUrl
    $env:MEDIAR_API_URL = $WebAppUrl  # Pass to Rust backend
    Write-Host "Using custom API URL from parameter: $WebAppUrl" -ForegroundColor Yellow
    Write-Host "Desktop app will call: $WebAppUrl/api/ai" -ForegroundColor Gray
} elseif ($apiUrlFromEnv) {
    # Use .env file value
    $env:VITE_API_BASE_URL = $apiUrlFromEnv
    $env:MEDIAR_API_URL = $apiUrlFromEnv  # Pass to Rust backend
    Write-Host "Using API URL from .env: $apiUrlFromEnv" -ForegroundColor Yellow
    Write-Host "Desktop app will call: $apiUrlFromEnv/api/ai" -ForegroundColor Gray
} else {
    # Use default production URL
    $env:VITE_API_BASE_URL = "https://app.mediar.ai"
    $env:MEDIAR_API_URL = "https://app.mediar.ai"  # Pass to Rust backend
    Write-Host "Using default API URL (production: https://app.mediar.ai)" -ForegroundColor Gray
}

# Update Tauri config with workspace identifier (devNumber already computed at top of script)
Write-Host "`n=== Workspace Configuration ===" -ForegroundColor Cyan

# Always update identifier and productName based on workspace using regex (preserves formatting)
Write-Host "Setting workspace identifier to dev$devNumber based on folder name '$WORKSPACE_NAME'..." -ForegroundColor Yellow
$tauriConfigPath = "src-tauri\tauri.conf.json"
$absolutePath = Join-Path (Get-Location).Path $tauriConfigPath
$content = [System.IO.File]::ReadAllText($absolutePath)

# Use regex replacements to preserve original JSON formatting
$content = $content -replace '"identifier":\s*"ai\.mediar\.desktop[^"]*"', "`"identifier`":  `"ai.mediar.desktop.dev$devNumber`""
$content = $content -replace '"productName":\s*"mediar[^"]*"', "`"productName`":  `"mediar-dev$devNumber`""
Write-Host "  [OK] Set identifier: ai.mediar.desktop.dev$devNumber" -ForegroundColor Green
Write-Host "  [OK] Set productName: mediar-dev$devNumber" -ForegroundColor Green

# Update Tauri config port
if ($selectedPort -ne 1420) {
    Write-Host "Updating Tauri config for port $selectedPort..." -ForegroundColor Yellow
    $content = $content -replace '"devUrl":\s*"http://localhost:\d+"', "`"devUrl`":  `"http://localhost:$selectedPort`""
    Write-Host "  Updated tauri.conf.json devUrl to port $selectedPort" -ForegroundColor Green
} else {
    # Reset to default port
    $content = $content -replace '"devUrl":\s*"http://localhost:\d+"', '"devUrl":  "http://localhost:1420"'
}

# Save with LF line endings and UTF-8 without BOM
$content = $content -replace "`r`n", "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($absolutePath, $content, $utf8NoBom)
Write-Host "[OK] Tauri configuration updated (formatting preserved)" -ForegroundColor Green

# Start the development server
Write-Host "Starting Mediar development server on port $selectedPort..." -ForegroundColor Green
Write-Host "URL: http://localhost:$selectedPort" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop..." -ForegroundColor Gray
"=== STARTING DEV SERVER ON PORT $selectedPort $(Get-Date) ===" | Out-File -Append logs\debug.log

try {
    # Start transcript to capture all console output
    Start-Transcript -Path "logs\dev.log" -Append

    # Run npm directly - this blocks and handles Ctrl+C naturally
    npm run tauri dev
}
finally {
    # Stop transcript first
    try {
        Stop-Transcript
    } catch {
        # Silently ignore if transcript wasn't running
    }

    # Cleanup runs when script exits (Ctrl+C or normal exit)
    Write-Host "`n`nCleaning up..." -ForegroundColor Yellow

    # Kill any remaining processes from current workspace
    Stop-MediarProcess -ProcessName "mediar" -PathPattern $WORKSPACE_NAME
    Stop-MediarProcess -ProcessName "terminator-mcp-agent" -PathPattern $WORKSPACE_NAME
    Stop-MediarProcess -ProcessName "node" -PathPattern $WORKSPACE_NAME
    Stop-MediarProcess -ProcessName "bun" -PathPattern $WORKSPACE_NAME

    # Restore terminal cursor using ANSI escape codes
    # ESC[?25h = Show cursor
    # ESC[0m = Reset all formatting
    $ESC = [char]27
    Write-Host "$ESC[?25h$ESC[0m" -NoNewline

    # Also try using PowerShell's built-in cursor visibility (Windows-specific)
    try {
        [Console]::CursorVisible = $true
    } catch {
        # Silently ignore if not supported
    }

    Write-Host "Cleanup complete. Terminal restored." -ForegroundColor Green
    "=== SCRIPT ENDED $(Get-Date) ===" | Out-File -Append logs\debug.log
}

