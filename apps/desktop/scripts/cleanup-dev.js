#!/usr/bin/env bun
/**
 * Comprehensive cleanup script for dev environment
 * Kills stale processes that may block the build (exit code 255 / Access is denied)
 *
 * IMPORTANT: Only kills processes running from mediar-app directory to avoid
 * killing unrelated processes (e.g., Claude Code, other projects)
 */

import { $ } from "bun";
import { existsSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const cwd = process.cwd();
const WORKSPACE_NAME = cwd.split(/[/\\]/).pop() || "mediar-app";

// Process names that can block builds - only killed if running from mediar-app paths
const PROCESSES_TO_CHECK = [
  "mediar.exe",
  "terminator-mcp-agent.exe",
  "bun-x86_64-pc-windows-msvc.exe",
  "bun-aarch64-pc-windows-msvc.exe",
  "cargo.exe",
  "rustc.exe",
];

async function killProjectProcesses() {
  // Kill processes only if they're running from mediar-app directory
  // This prevents killing Claude Code, other projects, etc.
  const processNames = PROCESSES_TO_CHECK.map(p => `'${p.replace(".exe", "")}'`).join(",");

  try {
    const script = `
$targetNames = @(${processNames})
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $targetNames -contains $_.Name -and $_.Path -and $_.Path -like '*mediar-app*'
}
foreach ($p in $procs) {
  try {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Output "$($p.Name):$($p.Id)"
  } catch {}
}
`;
    const result = await $`powershell -NoProfile -Command ${script}`.text();
    const killed = result
      .trim()
      .split("\n")
      .filter(l => l.includes(":"));
    for (const entry of killed) {
      const [name, pid] = entry.split(":");
      console.log(`  ✓ Killed ${name}.exe (PID ${pid})`);
    }
  } catch {
    // No processes found
  }
}

async function killTargetFolderProcesses() {
  // Kill any process running from target folder (compiled binaries)
  try {
    const script = `
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and $_.Path -like '*mediar-app*target*'
}
foreach ($p in $procs) {
  try {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Output $p.Id
  } catch {}
}
`;
    const result = await $`powershell -NoProfile -Command ${script}`.text();
    const pids = result
      .trim()
      .split("\n")
      .filter(p => /^\d+$/.test(p.trim()));
    for (const pid of pids) {
      console.log(`  ✓ Killed PID ${pid.trim()} (target folder process)`);
    }
  } catch {
    // No processes found
  }
}

/**
 * Check if the debug binary needs to be rebuilt due to tauri.conf.json identifier change.
 * Tauri embeds the identifier at compile time, so changing the config doesn't trigger a rebuild.
 * We track the last-used identifier and delete the binary if it changes.
 */
async function checkBinaryIdentifierMismatch() {
  const tauriConfigPath = join(cwd, "src-tauri", "tauri.conf.json");
  const markerPath = join(cwd, "target", "debug", ".tauri-identifier");
  const binaryPath = join(cwd, "target", "debug", "mediar.exe");

  if (!existsSync(tauriConfigPath) || !existsSync(binaryPath)) {
    return; // Nothing to check
  }

  try {
    // Read current identifier from tauri.conf.json
    const configContent = readFileSync(tauriConfigPath, "utf-8");
    const identifierMatch = configContent.match(/"identifier":\s*"([^"]+)"/);
    if (!identifierMatch) return;

    const currentIdentifier = identifierMatch[1];

    // Check if we have a marker file with the last-compiled identifier
    let lastIdentifier = "";
    if (existsSync(markerPath)) {
      lastIdentifier = readFileSync(markerPath, "utf-8").trim();
    }

    // If identifier changed, delete the binary to force recompile
    if (lastIdentifier && lastIdentifier !== currentIdentifier) {
      console.log(`  ⚠️  Config identifier changed: ${lastIdentifier} → ${currentIdentifier}`);
      try {
        rmSync(binaryPath, { force: true });
        console.log(`  ✓ Deleted debug binary to force recompile with new identifier`);
      } catch {
        console.log(`  ⚠️  Could not delete binary (may be in use)`);
      }
    }

    // Update marker file with current identifier
    try {
      writeFileSync(markerPath, currentIdentifier);
    } catch {
      // Target dir might not exist yet
    }
  } catch (e) {
    // Non-fatal, continue
  }
}

async function cleanCaches() {
  // Clean Vite caches
  const viteCaches = [".vite", "node_modules/.vite"];
  for (const cache of viteCaches) {
    const fullPath = join(cwd, cache);
    if (existsSync(fullPath)) {
      try {
        rmSync(fullPath, { recursive: true, force: true });
        console.log(`  ✓ Removed ${cache}`);
      } catch {
        // Locked, not critical
      }
    }
  }

  // Clean Tauri WebView cache
  const devNumber =
    { "mediar-app": "1", "mediar-app_2": "2", "mediar-app_3": "3", "mediar-app_4": "4" }[WORKSPACE_NAME] || "1";
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const tauriCache = join(localAppData, `ai.mediar.desktop.dev${devNumber}`, "EBWebView");
    if (existsSync(tauriCache)) {
      try {
        rmSync(tauriCache, { recursive: true, force: true });
        console.log(`  ✓ Removed Tauri WebView cache`);
      } catch {
        // Locked
      }
    }
  }
}

async function main() {
  console.log(`🧹 Cleaning up stale processes for ${WORKSPACE_NAME}...`);

  // Kill processes running from mediar-app directory only
  await killProjectProcesses();

  // Kill target folder processes (compiled binaries)
  await killTargetFolderProcesses();

  // Check if binary needs rebuild due to identifier change
  await checkBinaryIdentifierMismatch();

  // Clean caches
  console.log("🗑️  Cleaning caches...");
  await cleanCaches();

  // Wait for Windows to release file handles
  await Bun.sleep(1000);

  console.log("✅ Cleanup complete\n");
}

await main();
