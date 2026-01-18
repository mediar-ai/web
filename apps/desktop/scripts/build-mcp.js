#!/usr/bin/env bun

import { $ } from "bun";
import fs from "fs";
import os from "os";
import path from "path";

// Detect target architecture - check for Tauri target or use system architecture
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.TARGET;
const currentArch = process.arch;
const isArm64Target =
  targetTriple?.includes("aarch64") ||
  targetTriple?.includes("arm64") ||
  currentArch === "arm64" ||
  currentArch === "arm";
const BINARY_NAME = isArm64Target
  ? "terminator-mcp-agent-aarch64-pc-windows-msvc.exe"
  : "terminator-mcp-agent-x86_64-pc-windows-msvc.exe";

// Get shared binary path based on platform
function getSharedBinaryPath() {
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
      "mediar",
      "bin",
      "terminator-mcp-agent.exe"
    );
  } else if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "mediar", "bin", "terminator-mcp-agent");
  } else {
    return path.join(os.homedir(), ".local", "share", "mediar", "bin", "terminator-mcp-agent");
  }
}

// Local development configuration - uses sibling directory approach
// Can be overridden with TERMINATOR_PATH environment variable
// In monorepo: apps/desktop/ -> repos/ is 3 levels up (../../..)
const DEFAULT_TERMINATOR_DIR = "terminator";
const TERMINATOR_DIR = process.env.TERMINATOR_PATH || DEFAULT_TERMINATOR_DIR;
const LOCAL_TERMINATOR_PATH = path.resolve(process.cwd(), "../../..", TERMINATOR_DIR);
// Check both release and dev-release folders, prefer the newer one
const BINARY_FILENAME = process.platform === "win32" ? "terminator-mcp-agent.exe" : "terminator-mcp-agent";
const LOCAL_RELEASE_PATH = path.join(LOCAL_TERMINATOR_PATH, "target", "release", BINARY_FILENAME);
const LOCAL_DEV_RELEASE_PATH = path.join(LOCAL_TERMINATOR_PATH, "target", "dev-release", BINARY_FILENAME);

function getLocalBinaryPath() {
  const releaseExists = fs.existsSync(LOCAL_RELEASE_PATH);
  const devReleaseExists = fs.existsSync(LOCAL_DEV_RELEASE_PATH);

  if (releaseExists && devReleaseExists) {
    // Both exist, use the newer one
    const releaseStats = fs.statSync(LOCAL_RELEASE_PATH);
    const devReleaseStats = fs.statSync(LOCAL_DEV_RELEASE_PATH);
    const useDevRelease = devReleaseStats.mtime > releaseStats.mtime;
    console.log(
      `[build-mcp] Both release and dev-release exist. Using ${useDevRelease ? "dev-release" : "release"} (newer)`
    );
    return useDevRelease ? LOCAL_DEV_RELEASE_PATH : LOCAL_RELEASE_PATH;
  } else if (devReleaseExists) {
    console.log(`[build-mcp] Using dev-release binary`);
    return LOCAL_DEV_RELEASE_PATH;
  } else if (releaseExists) {
    console.log(`[build-mcp] Using release binary`);
    return LOCAL_RELEASE_PATH;
  }
  return LOCAL_RELEASE_PATH; // Default fallback (will fail later if neither exists)
}

const LOCAL_BINARY_PATH = getLocalBinaryPath();
const SHARED_BINARY_PATH = getSharedBinaryPath();

// Parse command line arguments
const args = process.argv.slice(2);
const useLocalBuild = args.includes("--local");
const forceNpm = args.includes("--npm");
const forceRebuild = args.includes("--force-rebuild");
const showHelp = args.includes("--help") || args.includes("-h");

if (showHelp) {
  console.log("🛠️  Terminator MCP Agent Build Script");
  console.log("");
  console.log("Usage:");
  console.log("  bun build-mcp.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --local          Use local terminator repository (../../../terminator)");
  console.log("  --npm            Force download from npm registry");
  console.log("  --force-rebuild  Force rebuild even if binary exists");
  console.log("  --help,-h        Show this help message");
  console.log("");
  console.log("Priority order (unless --npm is used):");
  console.log("  1. Shared binary path (LocalAppData)");
  console.log("  2. Local repository (if --local flag)");
  console.log("  3. NPM registry (fallback)");
  console.log("");
  console.log("Environment Variables:");
  console.log("  TERMINATOR_PATH  Override terminator directory name (default: 'terminator')");
  console.log("                   Example: TERMINATOR_PATH=terminator_3 bun build-mcp.js --local");
  console.log("");
  console.log("Paths:");
  console.log(`  Shared: ${SHARED_BINARY_PATH}`);
  console.log(`  Local repo: ${LOCAL_TERMINATOR_PATH}`);
  console.log(`    - release: target/release/`);
  console.log(`    - dev-release: target/dev-release/ (uses newer of the two)`);
  process.exit(0);
}

// Find the correct path for the target binary - should be in binaries directory for Tauri
// Since this script is now in scripts/ folder, we need to resolve relative to project root
const PROJECT_ROOT = path.resolve(path.dirname(process.argv[1]), "..");
let TARGET_PATH = path.join(PROJECT_ROOT, "src-tauri", "binaries", BINARY_NAME);
if (!fs.existsSync(path.dirname(TARGET_PATH))) {
  TARGET_PATH = path.join(process.cwd(), "src-tauri", "binaries", BINARY_NAME);
}

const TEMP_DIR = path.join(os.tmpdir(), `terminator-build-${Date.now()}`);

// Bun binary configuration
const BUN_BINARIES_DIR = path.join(PROJECT_ROOT, "src-tauri", "binaries");
const BUN_GITHUB_API = "https://api.github.com/repos/oven-sh/bun/releases/latest";

/**
 * Download and update bun binaries if needed
 * Downloads latest bun release for Windows x64 and ARM64
 */
async function updateBunBinaries() {
  console.log("========================================");
  console.log("🍞 Checking Bun Binaries");
  console.log("========================================\n");

  // Only update bun on Windows
  if (process.platform !== "win32") {
    console.log("⏭️  Skipping bun update (not Windows)");
    return;
  }

  try {
    // Get latest release info from GitHub
    console.log("📡 Fetching latest bun release info...");
    const response = await fetch(BUN_GITHUB_API, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "mediar-app-build",
      },
    });

    if (!response.ok) {
      console.log(`⚠️  Could not fetch bun release info (${response.status}), skipping update`);
      return;
    }

    const release = await response.json();
    const latestVersion = release.tag_name.replace(/^bun-v?/, "");
    console.log(`📦 Latest bun version: ${latestVersion}`);

    // Check current installed version
    const bunX64Path = path.join(BUN_BINARIES_DIR, "bun-x86_64-pc-windows-msvc.exe");
    let currentVersion = null;

    if (fs.existsSync(bunX64Path)) {
      try {
        const result = await $`${bunX64Path} --version`.quiet();
        currentVersion = result.stdout.toString().trim();
        console.log(`📦 Current bun version: ${currentVersion}`);
      } catch {
        console.log("⚠️  Could not detect current bun version");
      }
    }

    // Compare versions
    if (currentVersion === latestVersion) {
      console.log("✅ Bun binaries are up to date\n");
      return;
    }

    console.log(`🔄 Updating bun from ${currentVersion || "unknown"} to ${latestVersion}...`);

    // Find download URLs for Windows binaries
    const assets = release.assets || [];
    const x64Asset = assets.find(a => a.name === "bun-windows-x64.zip");
    const arm64Asset = assets.find(a => a.name === "bun-windows-aarch64.zip");

    if (!x64Asset) {
      console.log("⚠️  Could not find Windows x64 bun binary in release, skipping update");
      return;
    }

    // Download and extract x64 binary
    await downloadAndExtractBun(x64Asset.browser_download_url, "bun-x86_64-pc-windows-msvc.exe", "x64");

    // Download and extract ARM64 binary if available
    if (arm64Asset) {
      await downloadAndExtractBun(arm64Asset.browser_download_url, "bun-aarch64-pc-windows-msvc.exe", "arm64");
    }

    // Also copy to bun.exe for compatibility
    const bunExePath = path.join(BUN_BINARIES_DIR, "bun.exe");
    fs.copyFileSync(bunX64Path, bunExePath);
    console.log(`📋 Copied to bun.exe`);

    console.log(`✅ Bun binaries updated to ${latestVersion}\n`);
  } catch (error) {
    console.log(`⚠️  Error updating bun binaries: ${error.message}`);
    console.log("   Continuing with existing binaries...\n");
  }
}

/**
 * Download and extract a bun binary from a zip URL
 */
async function downloadAndExtractBun(url, targetName, arch) {
  const tempZip = path.join(os.tmpdir(), `bun-${arch}-${Date.now()}.zip`);
  const tempExtract = path.join(os.tmpdir(), `bun-${arch}-extract-${Date.now()}`);

  try {
    console.log(`📥 Downloading bun ${arch}...`);

    // Download the zip file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(tempZip, Buffer.from(buffer));
    console.log(`   Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);

    // Extract using PowerShell (Windows)
    console.log(`📦 Extracting...`);
    fs.mkdirSync(tempExtract, { recursive: true });
    await $`powershell -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${tempExtract}' -Force"`.quiet();

    // Find the bun.exe in the extracted folder (it's in a subdirectory)
    const extractedDirs = fs.readdirSync(tempExtract);
    let bunExe = null;

    for (const dir of extractedDirs) {
      const potentialPath = path.join(tempExtract, dir, "bun.exe");
      if (fs.existsSync(potentialPath)) {
        bunExe = potentialPath;
        break;
      }
    }

    if (!bunExe) {
      // Try root level
      const rootPath = path.join(tempExtract, "bun.exe");
      if (fs.existsSync(rootPath)) {
        bunExe = rootPath;
      }
    }

    if (!bunExe) {
      throw new Error("bun.exe not found in extracted archive");
    }

    // Copy to target location
    const targetPath = path.join(BUN_BINARIES_DIR, targetName);
    fs.copyFileSync(bunExe, targetPath);
    console.log(`   Installed ${targetName}`);
  } finally {
    // Cleanup
    try {
      if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
      if (fs.existsSync(tempExtract)) fs.rmSync(tempExtract, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
}

async function buildFromLocal() {
  console.log("🏠 Building from local terminator repository...");
  console.log(`📁 Local path: ${LOCAL_TERMINATOR_PATH}`);
  console.log(`📁 Target path: ${TARGET_PATH}`);

  try {
    // Check if local terminator directory exists
    if (!fs.existsSync(LOCAL_TERMINATOR_PATH)) {
      throw new Error(`Local terminator directory not found: ${LOCAL_TERMINATOR_PATH}`);
    }

    // Check if it's a valid terminator repository (workspace structure)
    const cargoTomlPath = path.join(LOCAL_TERMINATOR_PATH, "crates", "terminator-mcp-agent", "Cargo.toml");
    if (!fs.existsSync(cargoTomlPath)) {
      throw new Error(`Not a valid terminator repository (missing ${cargoTomlPath})`);
    }

    // Check if binary already exists and compare timestamps
    if (forceRebuild) {
      console.log("🔨 Force rebuild requested, building local terminator binary...");
      console.log("This may take a few minutes...");

      // Build the MCP agent from workspace root (Sentry is now a default feature)
      await $`cd ${LOCAL_TERMINATOR_PATH} && cargo build --release -p terminator-mcp-agent`;

      if (!fs.existsSync(LOCAL_BINARY_PATH)) {
        throw new Error(`Build completed but binary not found at: ${LOCAL_BINARY_PATH}`);
      }
      console.log("✅ Local build completed successfully!");
    } else if (fs.existsSync(LOCAL_BINARY_PATH) && fs.existsSync(TARGET_PATH)) {
      const sourceStats = fs.statSync(LOCAL_BINARY_PATH);
      const targetStats = fs.statSync(TARGET_PATH);

      if (sourceStats.mtime <= targetStats.mtime) {
        console.log("✅ Local binary already exists and is up to date, copying...");
      } else {
        console.log("🔄 Source binary is newer than target, copying fresh version...");
      }
    } else if (fs.existsSync(LOCAL_BINARY_PATH)) {
      console.log("✅ Local binary exists, copying...");
    } else {
      console.log("🔨 Building local terminator binary...");
      console.log("This may take a few minutes...");

      // Build the MCP agent from workspace root (Sentry is now a default feature)
      await $`cd ${LOCAL_TERMINATOR_PATH} && cargo build --release -p terminator-mcp-agent`;

      if (!fs.existsSync(LOCAL_BINARY_PATH)) {
        throw new Error(`Build completed but binary not found at: ${LOCAL_BINARY_PATH}`);
      }
      console.log("✅ Local build completed successfully!");
    }

    // Ensure target directory exists
    const targetDir = path.dirname(TARGET_PATH);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy the local binary
    console.log("📋 Copying local binary to src-tauri/binaries...");
    fs.copyFileSync(LOCAL_BINARY_PATH, TARGET_PATH);

    // Also create platform-agnostic names for Tauri compatibility
    const platformAgnosticPath = path.join(path.dirname(TARGET_PATH), "terminator-mcp-agent.exe");
    fs.copyFileSync(LOCAL_BINARY_PATH, platformAgnosticPath);

    // Verify the copied binary version
    try {
      const versionOutput = await $`"${TARGET_PATH}" --version`.text();
      const version = versionOutput.match(/terminator-mcp-agent (\d+\.\d+\.\d+)/)?.[1];
      console.log(`✅ Local MCP binary installed successfully! Version: ${version || "unknown"}`);
    } catch (error) {
      console.log("✅ Local MCP binary installed successfully!");
      console.log("⚠️  Could not verify version");
    }

    console.log(`📁 Created: ${TARGET_PATH}`);
    console.log(`📁 Created: ${platformAgnosticPath}`);
    console.log("🚨 Note: Using LOCAL development version - not for production!");
  } catch (error) {
    console.error("❌ Failed to build from local:", error.message);
    console.error("💡 Suggestions:");
    console.error("  - Ensure the terminator repository is cloned to the correct path");
    console.error("  - Run 'cargo build --release -p terminator-mcp-agent' manually in terminator workspace root");
    console.error("  - Check if Rust toolchain is properly installed");
    console.error(`  - Verify workspace structure: ${LOCAL_TERMINATOR_PATH}/crates/terminator-mcp-agent/`);
    throw error;
  }
}

async function checkVersionAndBuild() {
  console.log("🚀 Building MCP binary...");
  console.log(`📁 Target path: ${TARGET_PATH}`);

  // Check if binary already exists and compare versions
  if (fs.existsSync(TARGET_PATH)) {
    console.log("🔍 Checking current binary version...");
    try {
      const currentVersionOutput = await $`"${TARGET_PATH}" --version`.text();
      const currentVersion = currentVersionOutput.match(/terminator-mcp-agent (\d+\.\d+\.\d+)/)?.[1];

      if (currentVersion) {
        console.log(`📦 Current version: ${currentVersion}`);

        // Fetch latest npm package version
        console.log("🌐 Checking for latest npm version...");
        const response = await fetch("https://registry.npmjs.org/terminator-mcp-agent/latest");
        const packageInfo = await response.json();
        const latestVersion = packageInfo.version;

        if (latestVersion) {
          console.log(`🚀 Latest version: ${latestVersion}`);

          if (currentVersion === latestVersion) {
            console.log("✅ MCP binary is up to date, skipping build");
            process.exit(0);
          } else {
            console.log("🔄 Version mismatch, rebuilding binary...");
            // Remove old binary to force rebuild
            fs.rmSync(TARGET_PATH, { force: true });
          }
        } else {
          console.log("⚠️  Could not determine latest version, proceeding with rebuild...");
          fs.rmSync(TARGET_PATH, { force: true });
        }
      } else {
        console.log("⚠️  Could not determine current version, proceeding with rebuild...");
        fs.rmSync(TARGET_PATH, { force: true });
      }
    } catch (error) {
      console.log("⚠️  Error checking version, proceeding with rebuild...", error.message);
      fs.rmSync(TARGET_PATH, { force: true });
    }
  }
  try {
    // Clean up any existing temp directory
    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }

    console.log("📥 Installing MCP agent from npm...");

    // Create temp directory for npm install
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    // Install the latest MCP agent from npm
    console.log("📦 Running npm install terminator-mcp-agent@latest...");
    await $`cd ${TEMP_DIR} && npm install terminator-mcp-agent@latest`;

    // Find the installed binary - check common locations
    const npmArch = isArm64Target ? "win32-arm64-msvc" : "win32-x64-msvc";
    const possiblePaths = [
      path.join(TEMP_DIR, "node_modules", `terminator-mcp-${npmArch}`, "terminator-mcp-agent.exe"),
      path.join(
        TEMP_DIR,
        "node_modules",
        "terminator-mcp-agent",
        "node_modules",
        `terminator-mcp-${npmArch}`,
        "terminator-mcp-agent.exe"
      ),
      path.join(TEMP_DIR, "node_modules", "terminator-mcp-agent", "terminator-mcp-agent.exe"),
      path.join(TEMP_DIR, "node_modules", ".bin", "terminator-mcp-agent.exe"),
    ];

    let sourceBinary = null;
    for (const binaryPath of possiblePaths) {
      if (fs.existsSync(binaryPath)) {
        sourceBinary = binaryPath;
        break;
      }
    }

    if (!sourceBinary) {
      throw new Error(`MCP agent binary not found. Checked paths: ${possiblePaths.join(", ")}`);
    }

    console.log(`📋 Found MCP binary at: ${sourceBinary}`);
    console.log("📋 Copying binary to src-tauri/binaries...");

    // Ensure target directory exists
    const targetDir = path.dirname(TARGET_PATH);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.copyFileSync(sourceBinary, TARGET_PATH);

    // Also create platform-agnostic names for Tauri compatibility
    const platformAgnosticPath = path.join(path.dirname(TARGET_PATH), "terminator-mcp-agent.exe");
    fs.copyFileSync(sourceBinary, platformAgnosticPath);

    console.log("✅ MCP binary installed successfully!");
    console.log(`📁 Created: ${TARGET_PATH}`);
    console.log(`📁 Created: ${platformAgnosticPath}`);
  } catch (error) {
    console.error("❌ Failed to build MCP binary:", error.message);
    console.error("📊 Debug info:");
    console.error(`  - Current working directory: ${process.cwd()}`);
    console.error(`  - Script location: ${process.argv[1]}`);
    console.error(`  - Platform: ${os.platform()}`);
    console.error(`  - Node version: ${process.version}`);
    console.log("⚠️  Continuing without MCP binary...");
  } finally {
    // Clean up temp directory
    if (fs.existsSync(TEMP_DIR)) {
      try {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
      } catch (e) {
        console.log("Warning: Could not clean up temp directory:", e.message);
      }
    }
  }
}

// Check shared binary location first
async function checkSharedBinary() {
  console.log("🔍 Checking shared binary location...");
  console.log(`📁 Path: ${SHARED_BINARY_PATH}`);

  if (fs.existsSync(SHARED_BINARY_PATH)) {
    console.log("✅ Found binary in shared location!");

    // Check if local binary exists and is newer
    if (fs.existsSync(LOCAL_BINARY_PATH)) {
      const sharedStats = fs.statSync(SHARED_BINARY_PATH);
      const localStats = fs.statSync(LOCAL_BINARY_PATH);

      console.log(`📅 Shared binary modified: ${sharedStats.mtime.toLocaleString()}`);
      console.log(`📅 Local binary modified: ${localStats.mtime.toLocaleString()}`);

      if (localStats.mtime > sharedStats.mtime) {
        console.log("🔄 Local binary is newer than shared binary!");
        console.log("⏩ Skipping shared binary, will use local instead...");
        return false; // Return false to proceed with local build
      }
    }

    // Check version
    try {
      const versionOutput = await $`"${SHARED_BINARY_PATH}" --version`.text();
      const version = versionOutput.match(/terminator-mcp-agent (\d+\.\d+\.\d+)/)?.[1];
      console.log(`📦 Version: ${version || "unknown"}`);
    } catch (error) {
      console.log("⚠️  Could not verify version");
    }

    // Ensure target directory exists
    const targetDir = path.dirname(TARGET_PATH);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy the shared binary
    console.log("📋 Copying shared binary to src-tauri/binaries...");
    fs.copyFileSync(SHARED_BINARY_PATH, TARGET_PATH);

    // Also create platform-agnostic names for Tauri compatibility
    const platformAgnosticPath = path.join(path.dirname(TARGET_PATH), "terminator-mcp-agent.exe");
    fs.copyFileSync(SHARED_BINARY_PATH, platformAgnosticPath);

    console.log("✅ Successfully installed MCP binary from shared location!");
    console.log(`📁 Source: ${SHARED_BINARY_PATH}`);
    console.log(`📁 Target: ${TARGET_PATH}`);
    console.log(`📁 Also created: ${platformAgnosticPath}`);
    console.log("\n🎯 USING: Shared binary from LocalAppData (built by terminator-mcp-agent)");
    return true;
  }

  console.log("❌ No binary found in shared location");
  return false;
}

// Check if local binary exists and copy it (auto-detect mode)
async function checkLocalBinary() {
  console.log("🔍 Checking local terminator build...");
  console.log(`📁 Path: ${LOCAL_BINARY_PATH}`);

  if (fs.existsSync(LOCAL_BINARY_PATH)) {
    console.log("✅ Found local binary!");

    const localStats = fs.statSync(LOCAL_BINARY_PATH);
    console.log(`📅 Local binary modified: ${localStats.mtime.toLocaleString()}`);

    // Check version
    try {
      const versionOutput = await $`"${LOCAL_BINARY_PATH}" --version`.text();
      const version = versionOutput.match(/terminator-mcp-agent (\d+\.\d+\.\d+)/)?.[1];
      console.log(`📦 Version: ${version || "unknown"}`);
    } catch (error) {
      console.log("⚠️  Could not verify version");
    }

    // Ensure target directory exists
    const targetDir = path.dirname(TARGET_PATH);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy the local binary
    console.log("📋 Copying local binary to src-tauri/binaries...");
    fs.copyFileSync(LOCAL_BINARY_PATH, TARGET_PATH);

    // Also create platform-agnostic names for Tauri compatibility
    const platformAgnosticPath = path.join(path.dirname(TARGET_PATH), "terminator-mcp-agent.exe");
    fs.copyFileSync(LOCAL_BINARY_PATH, platformAgnosticPath);

    console.log("✅ Successfully installed MCP binary from local build!");
    console.log(`📁 Source: ${LOCAL_BINARY_PATH}`);
    console.log(`📁 Target: ${TARGET_PATH}`);
    console.log(`📁 Also created: ${platformAgnosticPath}`);
    console.log("\n🎯 USING: Local terminator build (../../../terminator/target/release)");
    return true;
  }

  console.log("❌ No local binary found");
  return false;
}

// Run the main function
async function main() {
  // First, update bun binaries if needed
  await updateBunBinaries();

  console.log("========================================");
  console.log("🚀 MCP Binary Installation Script");
  console.log("========================================\n");

  console.log("");

  // Check for forced npm mode
  if (forceNpm) {
    console.log("📦 NPM mode forced with --npm flag");
    console.log("\n🎯 USING: NPM registry (forced)");
    await checkVersionAndBuild();
    return;
  }

  // Priority 1: Check local binary (auto-detect - highest priority for dev)
  const localBinaryExists = await checkLocalBinary();
  if (localBinaryExists) {
    return;
  }

  // Priority 2: Check shared binary location
  const sharedBinaryExists = await checkSharedBinary();
  if (sharedBinaryExists) {
    return;
  }

  // Priority 3: Local build with --local flag (builds if not exists)
  if (useLocalBuild) {
    console.log("\n🏠 Local development mode enabled (--local flag)");
    await buildFromLocal();
    console.log("\n🎯 USING: Local repository build");
    return;
  }

  // Priority 4: Fall back to npm
  console.log("\n📦 Falling back to NPM package");
  console.log("💡 To use local build, run:");
  console.log("   cd ../../../terminator && cargo build --release -p terminator-mcp-agent");
  console.log("\n🎯 USING: NPM registry (fallback)");
  await checkVersionAndBuild();
}

main().catch(error => {
  console.error("💥 Build failed:", error.message);
  process.exit(1);
});
