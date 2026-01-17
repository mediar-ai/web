/**
 * Download msedgedriver for WebDriver E2E testing
 *
 * Usage: bun scripts/download-msedgedriver.ts
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

async function getEdgeVersion(): Promise<string> {
  const edgePaths = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  for (const edgePath of edgePaths) {
    if (existsSync(edgePath)) {
      // Use PowerShell to get version (cross-platform way to get exe version on Windows)
      const result = await $`powershell -Command "(Get-Item '${edgePath}').VersionInfo.FileVersion"`.text();
      return result.trim();
    }
  }

  throw new Error("Microsoft Edge not found");
}

async function downloadAndExtract(url: string, destDir: string): Promise<void> {
  console.log(`Downloading from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const zipPath = join(destDir, "edgedriver.zip");
  const arrayBuffer = await response.arrayBuffer();
  await Bun.write(zipPath, arrayBuffer);
  console.log(`Downloaded to: ${zipPath}`);

  // Extract using PowerShell (available on Windows)
  console.log(`Extracting to: ${destDir}`);
  await $`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`;

  // Cleanup zip
  await $`rm ${zipPath}`;
}

async function main() {
  console.log("========================================");
  console.log("  Download msedgedriver for E2E Testing");
  console.log("========================================\n");

  try {
    // Get Edge version
    const edgeVersion = await getEdgeVersion();
    console.log(`Edge version: ${edgeVersion}`);

    // Download URL
    const url = `https://msedgedriver.microsoft.com/${edgeVersion}/edgedriver_win64.zip`;

    // Extract to .cargo/bin (already in PATH)
    const destDir = join(homedir(), ".cargo", "bin");
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    await downloadAndExtract(url, destDir);

    const driverPath = join(destDir, "msedgedriver.exe");
    console.log(`\n✅ Done! msedgedriver installed at: ${driverPath}`);
  } catch (error) {
    console.error(`\n❌ Error: ${error}`);
    process.exit(1);
  }
}

main();
