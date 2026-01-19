#!/usr/bin/env bun
/**
 * Spawn a local Hyper-V dev VM from Azure mcp-full image
 *
 * First time setup (automatic):
 *   bun scripts/spawn-dev-vm.ts --setup
 *
 * Usage:
 *   bun scripts/spawn-dev-vm.ts
 *   bun scripts/spawn-dev-vm.ts --name my-vm
 *   bun scripts/spawn-dev-vm.ts --destroy my-vm
 *   bun scripts/spawn-dev-vm.ts --force-download
 *
 * Prerequisites (auto-installed by --setup):
 *   - Hyper-V enabled
 *   - Azure CLI logged in
 *   - azcopy installed
 *   - External VM Switch configured
 */

import { $ } from "bun";
import { existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// ============================================
// Config
// ============================================
const HOME = homedir();
const MEDIAR_DIR = join(HOME, ".mediar");
const VMS_DIR = join(MEDIAR_DIR, "vms");
const CACHE_VHD_RAW = join(VMS_DIR, "mcp-dev-base.vhd"); // Azure exports VHD format
const CACHE_VHD = join(VMS_DIR, "mcp-dev-base.vhdx"); // Converted to VHDX for Gen2
const VERSION_FILE = join(VMS_DIR, "version.json");

// Azure config - uses az login, no secrets in code
const GALLERY_RG = "UI-AUTOMATION-IMAGES-RG";
const GALLERY_NAME = "mcpimages";
const IMAGE_DEF = "mcp-full";
const TEMP_RG = "mcp-temp-export-rg";
const LOCATION = "eastus";

// VM defaults
const DEFAULT_VM_NAME = "mcp-dev";
const DEFAULT_MEMORY_MB = 1024; // 1GB startup, dynamic memory enabled
const DEFAULT_CPUS = 4;
const MIN_MEMORY_MB = 512; // 512MB minimum for dynamic memory
const MAX_MEMORY_MB = 4096; // 4GB maximum for dynamic memory
const EXTERNAL_SWITCH_NAME = "External Switch";

// Credentials (from packer image build) - loaded from environment variables
// Validation is deferred to when credentials are actually needed (not --setup or --help)
const VM_USERNAME = process.env.VM_USERNAME || "vmuser";

function getVmPassword(): string {
  const password = process.env.VM_PASSWORD;
  if (!password) {
    throw new Error("VM_PASSWORD environment variable is required for VM operations");
  }
  return password;
}

function getVncPassword(): string {
  const password = process.env.VNC_PASSWORD;
  if (!password) {
    throw new Error("VNC_PASSWORD environment variable is required for VNC operations");
  }
  return password;
}

// Snapshot paths
const SNAPSHOT_VHD = join(VMS_DIR, "mcp-dev-authenticated.vhdx");
const LOG_FILE = join(VMS_DIR, "spawn-vm.log");

// Default resolution for VNC
const DEFAULT_RESOLUTION = { width: 1920, height: 1080 };

function hasTightVNC(): boolean {
  return ["C:\Program Files\TightVNC\tvnviewer.exe", "C:\Program Files (x86)\TightVNC\tvnviewer.exe"].some(p =>
    existsSync(p)
  );
}

// ============================================
// Helpers
// ============================================
async function ps(script: string, quiet = true): Promise<string> {
  const result = quiet
    ? await $`powershell -NoProfile -Command ${script}`.quiet()
    : await $`powershell -NoProfile -Command ${script}`;
  return result.stdout.toString().trim();
}

async function psCheck(script: string): Promise<boolean> {
  try {
    await $`powershell -NoProfile -Command ${script}`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function psAdmin(script: string): Promise<void> {
  await $`powershell -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command ${script.replace(/"/g, '\\"')}'"`;
}

async function az(args: string, showOutput = false): Promise<string> {
  try {
    const result = showOutput
      ? await $`powershell -NoProfile -Command "az ${args}"`
      : await $`powershell -NoProfile -Command "az ${args}"`.quiet();
    return result.stdout.toString().trim();
  } catch (e: any) {
    const stderr = e.stderr?.toString() || "";
    const stdout = e.stdout?.toString() || "";
    log(`  AZ ERROR: ${stderr || stdout || e.message}`);
    throw e;
  }
}

function log(msg: string) {
  console.log(msg);
}

function logStep(step: string) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(step);
  console.log("=".repeat(50));
}

function logSuccess(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function logWarning(msg: string) {
  console.log(`  ⚠ ${msg}`);
}

function logError(msg: string) {
  console.log(`  ✗ ${msg}`);
}

async function isAdmin(): Promise<boolean> {
  try {
    const result = await ps(
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
    );
    return result.toLowerCase() === "true";
  } catch {
    return false;
  }
}

async function relaunchAsAdmin(): Promise<void> {
  log("\n  ⚠ This script requires Administrator privileges for Hyper-V commands.");
  log("  Relaunching with elevation...");
  log(`  Log file: ${LOG_FILE}\n`);

  // Ensure log directory exists
  mkdirSync(VMS_DIR, { recursive: true });

  const scriptPath = process.argv[1];
  const args = process.argv.slice(2).join(" ");
  const cwd = process.cwd();

  // Write a temp PowerShell script to avoid nested quoting hell
  const tempScript = join(VMS_DIR, "elevate-spawn.ps1");
  const ps1Content = `
Set-Location "${cwd}"
bun "${scriptPath}" ${args} 2>&1 | Tee-Object -FilePath "${LOG_FILE}"
if (-not $?) {
  Write-Host
  Write-Host "[ERROR] Script failed. Press any key to close..." -ForegroundColor Red
  $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
`.trim();

  writeFileSync(tempScript, ps1Content, "utf-8");

  try {
    // Elevate and run the temp script (use array for ArgumentList to avoid quoting issues)
    const elevateCmd = `Start-Process -FilePath 'powershell' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScript.replace(/'/g, "''")}') -Verb RunAs -Wait`;
    await $`powershell -NoProfile -Command ${elevateCmd}`;
    // Clean up temp script
    try {
      unlinkSync(tempScript);
    } catch {}
    process.exit(0);
  } catch (e) {
    logError("Failed to elevate. Please run manually in an Admin terminal:");
    log("  1. Press Win+X → Terminal (Admin)");
    log(`  2. Run: bun ${scriptPath} ${args}`);
    log(`  Or check log: ${LOG_FILE}`);
    process.exit(1);
  }
}

async function openRDP(ip: string): Promise<void> {
  log("  Opening RDP connection...");
  // Create .rdp file with credentials (cmdkey approach)
  try {
    // Store credentials temporarily
    await ps(`cmdkey /generic:${ip} /user:${VM_USERNAME} /pass:${getVmPassword()}`);
    // Launch mstsc
    await $`powershell -NoProfile -Command "Start-Process mstsc -ArgumentList '/v:${ip}'"`;
    log("  ✓ RDP window opened");
  } catch (e) {
    logWarning("Could not auto-open RDP. Connect manually.");
  }
}

async function openVNC(ip: string): Promise<void> {
  log("  Opening VNC connection (console session)...");
  try {
    const tvncPaths = [
      "C:\Program Files\TightVNC\tvnviewer.exe",
      "C:\Program Files (x86)\TightVNC\tvnviewer.exe",
      join(HOME, "AppData\Local\Programs\TightVNC\tvnviewer.exe"),
    ];
    const tvncPath = tvncPaths.find(p => existsSync(p));
    if (tvncPath) {
      // Launch TightVNC with password and auto-scale
      const vncArgs = `${ip}::5900 -password=${getVncPassword()} -scale=auto`;
      await $`powershell -NoProfile -Command "Start-Process '${tvncPath}' -ArgumentList ${vncArgs}"`;
      log("  ✓ TightVNC Viewer opened (auto-scale enabled)");
    } else {
      logWarning("TightVNC not found. Install: winget install GlavSoft.TightVNC");
      log(`     Manual: tvnviewer ${ip}::5900 -password=${getVncPassword()} -scale=auto`);
    }
  } catch (e) {
    logWarning("Could not open VNC");
  }
}

// ============================================
// Snapshot VM (save authenticated state)
// ============================================
async function snapshotVM(vmName: string): Promise<void> {
  logStep(`Creating Snapshot from VM: ${vmName}`);

  // Check VM exists
  if (!(await vmExists(vmName))) {
    logError(`VM "${vmName}" does not exist`);
    process.exit(1);
  }

  const vmState = await ps(`(Get-VM -Name "${vmName}").State`);

  // Shut down VM cleanly if running
  if (vmState === "Running") {
    log("  Shutting down VM gracefully...");
    await ps(`Stop-VM -Name "${vmName}" -Force`);

    // Wait for VM to stop
    for (let i = 0; i < 30; i++) {
      const state = await ps(`(Get-VM -Name "${vmName}").State`);
      if (state === "Off") break;
      await Bun.sleep(2000);
      process.stdout.write(".");
    }
    console.log();
    logSuccess("VM stopped");
  }

  // Get the VM's VHD path
  const vmVhdPath = await ps(`(Get-VMHardDiskDrive -VMName "${vmName}").Path`);
  if (!vmVhdPath || !existsSync(vmVhdPath)) {
    logError(`Could not find VHD for VM "${vmName}"`);
    process.exit(1);
  }

  log(`  Source VHD: ${vmVhdPath}`);
  log(`  Snapshot:   ${SNAPSHOT_VHD}`);

  // Copy VHD as snapshot
  log("  Copying VHD (this may take a few minutes)...");
  copyFileSync(vmVhdPath, SNAPSHOT_VHD);

  logSuccess("Snapshot created!");
  log(`
  Snapshot saved to: ${SNAPSHOT_VHD}

  Future VMs can use this authenticated snapshot:
    bun scripts/spawn-dev-vm.ts --use-snapshot --name my-new-vm

  The original VM "${vmName}" is now stopped.
  To restart it: Start-VM -Name "${vmName}"
`);
}

// ============================================
// Prerequisites Check & Auto-Setup
// ============================================
interface PrereqStatus {
  isAdmin: boolean;
  hypervEnabled: boolean;
  azureLoggedIn: boolean;
  azureSubscription: string;
  azcopyInstalled: boolean;
  externalSwitch: string | null;
  networkAdapter: string | null;
}

async function checkPrerequisites(): Promise<PrereqStatus> {
  const status: PrereqStatus = {
    isAdmin: false,
    hypervEnabled: false,
    azureLoggedIn: false,
    azureSubscription: "",
    azcopyInstalled: false,
    externalSwitch: null,
    networkAdapter: null,
  };

  // Check admin
  status.isAdmin = await psCheck(
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"
  );

  // Check Hyper-V
  status.hypervEnabled = await psCheck("Get-VMHost -ErrorAction Stop");

  // Check Azure CLI
  try {
    status.azureSubscription = await az("account show --query name -o tsv");
    status.azureLoggedIn = true;
  } catch {
    status.azureLoggedIn = false;
  }

  // Check azcopy
  try {
    await $`powershell -NoProfile -Command "azcopy --version"`.quiet();
    status.azcopyInstalled = true;
  } catch {
    status.azcopyInstalled = false;
  }

  // Check external switch
  try {
    status.externalSwitch = await ps(
      "Get-VMSwitch | Where-Object { $_.SwitchType -eq 'External' } | Select-Object -First 1 -ExpandProperty Name"
    );
  } catch {
    status.externalSwitch = null;
  }

  // Get available network adapter for switch creation
  try {
    status.networkAdapter = await ps(
      "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.Name -notlike '*vEthernet*' -and $_.Name -notlike '*Loopback*' } | Select-Object -First 1 -ExpandProperty Name"
    );
  } catch {
    status.networkAdapter = null;
  }

  return status;
}

function printPrereqStatus(status: PrereqStatus) {
  logStep("Prerequisites Status");

  if (status.isAdmin) {
    logSuccess("Running as Administrator");
  } else {
    logError("NOT running as Administrator");
  }

  if (status.hypervEnabled) {
    logSuccess("Hyper-V enabled");
  } else {
    logError("Hyper-V NOT enabled");
  }

  if (status.azureLoggedIn) {
    logSuccess(`Azure CLI logged in (${status.azureSubscription})`);
  } else {
    logError("Azure CLI NOT logged in");
  }

  if (status.azcopyInstalled) {
    logSuccess("azcopy installed");
  } else {
    logError("azcopy NOT installed");
  }

  if (status.externalSwitch) {
    logSuccess(`External Switch: ${status.externalSwitch}`);
  } else {
    logError("External Switch NOT configured");
    if (status.networkAdapter) {
      log(`     Available adapter: ${status.networkAdapter}`);
    }
  }
}

async function runSetup(): Promise<boolean> {
  logStep("Auto-Setup Prerequisites");

  const status = await checkPrerequisites();
  let needsReboot = false;

  // Must be admin for setup
  if (!status.isAdmin) {
    logError("Setup requires Administrator privileges");
    log("\n  Please run this in an elevated PowerShell:");
    log("    1. Press Win+X, select 'Terminal (Admin)'");
    log("    2. Run: bun scripts/spawn-dev-vm.ts --setup");
    return false;
  }

  // Enable Hyper-V
  if (!status.hypervEnabled) {
    log("\n  Installing Hyper-V...");
    try {
      await ps("Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart", false);
      logSuccess("Hyper-V enabled (reboot required)");
      needsReboot = true;
    } catch (e) {
      logError(`Failed to enable Hyper-V: ${e}`);
    }
  } else {
    logSuccess("Hyper-V already enabled");
  }

  // Install azcopy
  if (!status.azcopyInstalled) {
    log("\n  Installing azcopy via winget...");
    try {
      await $`powershell -NoProfile -Command "winget install Microsoft.Azure.AzCopy.10 --accept-source-agreements --accept-package-agreements"`;
      logSuccess("azcopy installed");
      log("     Note: Restart shell to use azcopy");
    } catch (e) {
      logWarning(`winget install failed, trying direct download...`);
      try {
        await ps(`
          $url = 'https://aka.ms/downloadazcopy-v10-windows'
          $zip = "$env:TEMP\\azcopy.zip"
          $dest = "$env:LOCALAPPDATA\\Programs\\azcopy"
          Invoke-WebRequest -Uri $url -OutFile $zip
          Expand-Archive -Path $zip -DestinationPath $dest -Force
          $azcopyExe = Get-ChildItem -Path $dest -Filter 'azcopy.exe' -Recurse | Select-Object -First 1
          $azcopyDir = $azcopyExe.DirectoryName
          [Environment]::SetEnvironmentVariable('Path', $env:Path + ';' + $azcopyDir, 'User')
          Remove-Item $zip
        `);
        logSuccess("azcopy installed via direct download");
      } catch {
        logError(`Failed to install azcopy: ${e}`);
      }
    }
  } else {
    logSuccess("azcopy already installed");
  }

  // Azure CLI login check
  if (!status.azureLoggedIn) {
    log("\n  Azure CLI not logged in");
    log("  Please run: az login");
    log("  Then re-run this script");
  } else {
    logSuccess("Azure CLI already logged in");
  }

  // Create External Switch
  if (!status.externalSwitch && status.networkAdapter) {
    log(`\n  Creating External Switch on '${status.networkAdapter}'...`);
    try {
      await ps(
        `New-VMSwitch -Name '${EXTERNAL_SWITCH_NAME}' -NetAdapterName '${status.networkAdapter}' -AllowManagementOS $true`,
        false
      );
      logSuccess(`External Switch created on ${status.networkAdapter}`);
    } catch (e) {
      logError(`Failed to create switch: ${e}`);
      log("     Try manually in Hyper-V Manager → Virtual Switch Manager");
    }
  } else if (status.externalSwitch) {
    logSuccess("External Switch already configured");
  } else {
    logWarning("No suitable network adapter found for External Switch");
  }

  // Summary
  logStep("Setup Complete");

  if (needsReboot) {
    log("\n  ⚠ REBOOT REQUIRED for Hyper-V");
    log("  After reboot, run: bun scripts/spawn-dev-vm.ts");
    return false;
  }

  if (!status.azureLoggedIn) {
    log("\n  Next step: az login");
    log("  Then run: bun scripts/spawn-dev-vm.ts");
    return false;
  }

  log("\n  All prerequisites ready!");
  log("  Run: bun scripts/spawn-dev-vm.ts");
  return true;
}

async function validatePrerequisites(): Promise<{ ok: boolean; status: PrereqStatus }> {
  const status = await checkPrerequisites();
  printPrereqStatus(status);

  const allGood =
    status.isAdmin && status.hypervEnabled && status.azureLoggedIn && status.azcopyInstalled && !!status.externalSwitch;

  if (!allGood) {
    log("\n  Run setup to fix: bun scripts/spawn-dev-vm.ts --setup");
  }

  return { ok: allGood, status };
}

// ============================================
// Azure Export
// ============================================
async function convertVhdToVhdx(): Promise<void> {
  logStep("Converting VHD to VHDX");
  log(`  Source: ${CACHE_VHD_RAW}`);
  log(`  Destination: ${CACHE_VHD}`);
  log(`  This may take a few minutes...`);

  await ps(
    `
    Convert-VHD -Path "${CACHE_VHD_RAW}" -DestinationPath "${CACHE_VHD}" -VHDType Dynamic
  `,
    false
  );

  if (!existsSync(CACHE_VHD)) {
    throw new Error(`Conversion failed - VHDX not found at ${CACHE_VHD}`);
  }

  // Optionally delete the raw VHD to save space
  log(`  Cleaning up raw VHD...`);
  rmSync(CACHE_VHD_RAW, { force: true });

  logSuccess("Conversion complete!");
}

async function getLatestImageVersion(): Promise<string> {
  log("  Fetching image versions...");
  const output = await az(
    `sig image-version list --resource-group ${GALLERY_RG} --gallery-name ${GALLERY_NAME} --gallery-image-definition ${IMAGE_DEF} --query "[].name" -o tsv`
  );
  const versions = output.split("\n").filter(Boolean);
  if (versions.length === 0) {
    throw new Error(`No image versions found in ${GALLERY_NAME}/${IMAGE_DEF}`);
  }
  versions.sort();
  return versions[versions.length - 1];
}

async function exportFromAzure(forceDownload: boolean): Promise<void> {
  logStep("Checking Cached VHD");

  // Check if we have the converted VHDX already
  if (existsSync(CACHE_VHD) && !forceDownload) {
    logSuccess(`Found: ${CACHE_VHD}`);
    if (existsSync(VERSION_FILE)) {
      const version = JSON.parse(await Bun.file(VERSION_FILE).text());
      log(`  Version: ${version.imageVersion} (${version.exportedAt})`);
    }
    log("  Use --force-download to re-download");
    return;
  }

  // Check if we have raw VHD that just needs conversion
  if (existsSync(CACHE_VHD_RAW) && !existsSync(CACHE_VHD) && !forceDownload) {
    logSuccess(`Found raw VHD, converting to VHDX...`);
    await convertVhdToVhdx();
    return;
  }

  logStep("Exporting from Azure Compute Gallery");

  const imageVersion = await getLatestImageVersion();
  log(`  Image: ${IMAGE_DEF} (version: ${imageVersion})`);

  const subscriptionId = await az("account show --query id -o tsv");

  log("  Creating temp resource group...");
  await az(`group create --name ${TEMP_RG} --location ${LOCATION} -o none`);

  const diskName = "mcp-export-disk";
  const imageId = `/subscriptions/${subscriptionId}/resourceGroups/${GALLERY_RG}/providers/Microsoft.Compute/galleries/${GALLERY_NAME}/images/${IMAGE_DEF}/versions/${imageVersion}`;

  try {
    log("  Creating managed disk from gallery image...");
    log(`    (this takes 2-5 minutes)`);
    const diskResult = await az(
      `disk create --resource-group ${TEMP_RG} --name ${diskName} --gallery-image-reference ${imageId} --location ${LOCATION} --hyper-v-generation V2`,
      true // show output for debugging
    );
    log(`  Disk creation result length: ${diskResult.length}`);

    // Verify disk exists
    log("  Verifying disk was created...");
    const diskCheck = await az(`disk show --resource-group ${TEMP_RG} --name ${diskName} --query name -o tsv`, true);
    log(`  Disk check result: "${diskCheck}"`);

    log("  Granting SAS access (1 hour)...");
    // Run grant-access and capture full output
    const grantResult =
      await $`powershell -NoProfile -Command "az disk grant-access --resource-group ${TEMP_RG} --name ${diskName} --duration-in-seconds 3600 --access-level Read"`;
    log(`  Grant access stdout: ${grantResult.stdout.toString().substring(0, 200)}`);
    log(`  Grant access stderr: ${grantResult.stderr.toString().substring(0, 200)}`);

    // Parse the JSON response to get accessSAS (note: capital S)
    const grantJson = JSON.parse(grantResult.stdout.toString());
    const sasUrl = grantJson.accessSAS;

    // Debug: check what we got
    log(`  SAS URL length: ${sasUrl.length}`);
    if (!sasUrl || sasUrl.length < 100) {
      log(`  WARNING: SAS URL looks invalid: ${sasUrl.substring(0, 200)}`);
      throw new Error("Failed to get valid SAS URL from Azure");
    }
    log(`  SAS URL starts with: ${sasUrl.substring(0, 80)}...`);

    mkdirSync(VMS_DIR, { recursive: true });

    log(`  Downloading VHD (~10-20 min)...`);
    log(`  Destination: ${CACHE_VHD_RAW}`);

    // Add delay to ensure SAS token propagation
    log(`  Waiting 15s for SAS token propagation...`);
    await Bun.sleep(15000);

    // Write a PowerShell script with retry logic
    const downloadScript = join(VMS_DIR, "download.ps1");
    const scriptContent = `
$ErrorActionPreference = 'Continue'
$sasUrl = '${sasUrl}'
$dest = '${CACHE_VHD_RAW}'
Write-Host "Source URL length: $($sasUrl.Length)"
Write-Host "Destination: $dest"

$maxRetries = 3
$retry = 0
$success = $false

while (-not $success -and $retry -lt $maxRetries) {
    $retry++
    Write-Host "Download attempt $retry of $maxRetries..."

    # Use smaller block size and cap bandwidth to avoid stalls
    # --overwrite true allows resume of partial downloads
    & azcopy copy "$sasUrl" "$dest" --from-to BlobLocal --block-size-mb 8 --cap-mbps 500 --overwrite ifSourceNewer

    if ($LASTEXITCODE -eq 0) {
        $success = $true
        Write-Host "Download completed successfully!"
    } else {
        Write-Host "Attempt $retry failed with exit code $LASTEXITCODE"
        if ($retry -lt $maxRetries) {
            Write-Host "Waiting 10 seconds before retry..."
            Start-Sleep -Seconds 10
        }
    }
}

if (-not $success) {
    Write-Error "Download failed after $maxRetries attempts"
    exit 1
}
`;
    await Bun.write(downloadScript, scriptContent);

    try {
      await $`powershell -NoProfile -ExecutionPolicy Bypass -File ${downloadScript}`;
    } finally {
      rmSync(downloadScript, { force: true });
    }

    // Verify download succeeded
    if (!existsSync(CACHE_VHD_RAW)) {
      throw new Error(`Download failed - VHD not found at ${CACHE_VHD_RAW}`);
    }

    logSuccess("Download complete!");

    // Convert VHD to VHDX for Hyper-V Gen2
    await convertVhdToVhdx();

    const versionInfo = {
      imageVersion,
      imageDef: IMAGE_DEF,
      exportedAt: new Date().toISOString(),
    };
    await Bun.write(VERSION_FILE, JSON.stringify(versionInfo, null, 2));
  } finally {
    log("  Cleaning up Azure resources...");
    await az(`disk revoke-access --resource-group ${TEMP_RG} --name ${diskName} -o none`).catch(() => {});
    await az(`disk delete --resource-group ${TEMP_RG} --name ${diskName} --yes -o none`).catch(() => {});
    await az(`group delete --name ${TEMP_RG} --yes --no-wait -o none`).catch(() => {});
  }
}

// ============================================
// Hyper-V VM Creation
// ============================================
async function getExternalSwitch(): Promise<string> {
  return await ps(
    "Get-VMSwitch | Where-Object { $_.SwitchType -eq 'External' } | Select-Object -First 1 -ExpandProperty Name"
  );
}

async function vmExists(vmName: string): Promise<boolean> {
  return await psCheck(`Get-VM -Name "${vmName}" -ErrorAction Stop`);
}

async function createVM(vmName: string, memoryMB: number, cpus: number, sourceVhd?: string): Promise<void> {
  logStep(`Creating Hyper-V VM: ${vmName}`);

  if (await vmExists(vmName)) {
    logWarning(`VM "${vmName}" already exists`);
    log("  Use --destroy to remove it, or --name <other-name>");
    process.exit(1);
  }

  const vhdSource = sourceVhd || CACHE_VHD;
  const vmVhd = join(VMS_DIR, `${vmName}.vhdx`);
  log(`  Source: ${vhdSource}`);
  log(`  Copying VHD to ${vmVhd}...`);
  copyFileSync(vhdSource, vmVhd);

  const switchName = await getExternalSwitch();

  log(`  Creating VM (RAM: ${memoryMB}MB startup, dynamic ${MIN_MEMORY_MB}-${MAX_MEMORY_MB}MB, CPUs: ${cpus})...`);
  await ps(`
    $vmName = "${vmName}"
    $vhdPath = "${vmVhd.replace(/\\/g, "\\\\")}"
    $switchName = "${switchName}"

    New-VM -Name $vmName -Generation 2 -MemoryStartupBytes ${memoryMB}MB -VHDPath $vhdPath -SwitchName $switchName
    Set-VM -Name $vmName -ProcessorCount ${cpus} -AutomaticStartAction Nothing -AutomaticStopAction ShutDown
    Set-VMMemory -VMName $vmName -DynamicMemoryEnabled $true -MinimumBytes ${MIN_MEMORY_MB}MB -MaximumBytes ${MAX_MEMORY_MB}MB -StartupBytes ${memoryMB}MB
    Set-VMFirmware -VMName $vmName -EnableSecureBoot Off
    Enable-VMIntegrationService -VMName $vmName -Name "Guest Service Interface"
  `);

  logSuccess(`VM created with switch: ${switchName}`);

  log("  Starting VM...");
  await ps(`Start-VM -Name "${vmName}"`);
  logSuccess("VM started");
}

async function getVMIP(vmName: string): Promise<string | null> {
  const ip = await ps(`
    (Get-VMNetworkAdapter -VMName "${vmName}" | Select-Object -ExpandProperty IPAddresses | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' } | Select-Object -First 1)
  `);
  return ip || null;
}

async function waitForMCP(vmName: string): Promise<string> {
  logStep("Waiting for VM and MCP...");

  log("  Waiting for VM IP address...");
  let ip: string | null = null;
  for (let i = 0; i < 60; i++) {
    ip = await getVMIP(vmName);
    if (ip) break;
    await Bun.sleep(2000);
    process.stdout.write(".");
  }
  console.log();

  if (!ip) {
    logError("Timeout waiting for VM IP");
    process.exit(1);
  }
  logSuccess(`VM IP: ${ip}`);

  log("  Waiting for MCP health endpoint...");
  const healthUrl = `http://${ip}:8080/health`;
  for (let i = 0; i < 90; i++) {
    try {
      const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        logSuccess("MCP is healthy!");
        return ip;
      }
    } catch {
      // Keep trying
    }
    await Bun.sleep(2000);
    process.stdout.write(".");
  }
  console.log();

  logWarning("Timeout waiting for MCP (VM may still be booting)");
  log(`  Try: curl ${healthUrl}`);
  return ip;
}

// ============================================
// Destroy VM
// ============================================
async function destroyVM(vmName: string): Promise<void> {
  logStep(`Destroying VM: ${vmName}`);

  if (!(await vmExists(vmName))) {
    logWarning(`VM "${vmName}" does not exist`);
    return;
  }

  log("  Stopping VM...");
  await ps(`Stop-VM -Name "${vmName}" -Force -TurnOff -ErrorAction SilentlyContinue`);

  const vhdPath = await ps(`(Get-VMHardDiskDrive -VMName "${vmName}").Path`);

  log("  Removing VM...");
  await ps(`Remove-VM -Name "${vmName}" -Force`);

  if (vhdPath && existsSync(vhdPath)) {
    log(`  Deleting VHD: ${vhdPath}`);
    rmSync(vhdPath);
  }

  logSuccess("VM destroyed");
}

// ============================================
// List VMs
// ============================================
async function listVMs(): Promise<void> {
  logStep("Mediar Dev VMs");

  const vms = await ps(`
    Get-VM | Where-Object { $_.Name -like 'mcp-*' } | ForEach-Object {
      $ip = (Get-VMNetworkAdapter -VMName $_.Name | Select-Object -ExpandProperty IPAddresses | Where-Object { $_ -match '^\\d+\\.\\d+\\.\\d+\\.\\d+$' } | Select-Object -First 1)
      "$($_.Name)|$($_.State)|$ip"
    }
  `);

  if (!vms) {
    log("  No VMs found");
    return;
  }

  console.log("\n  Name            State     IP              MCP");
  console.log("  " + "-".repeat(60));

  for (const line of vms.split("\n").filter(Boolean)) {
    const [name, state, ip] = line.split("|");
    const mcpUrl = ip ? `http://${ip}:8080` : "-";
    console.log(`  ${name.padEnd(15)} ${state.padEnd(9)} ${(ip || "-").padEnd(15)} ${mcpUrl}`);
  }
}

// ============================================
// Main
// ============================================
async function main() {
  console.log("\n  Mediar Dev VM Spawner");
  console.log("  =====================\n");

  const args = process.argv.slice(2);

  // Pre-flight checks BEFORE elevation (so errors show immediately without UAC)
  if (!args.includes("--help") && !args.includes("-h")) {
    // Check --use-snapshot has a snapshot file
    if (args.includes("--use-snapshot")) {
      if (!existsSync(SNAPSHOT_VHD)) {
        logError(`No snapshot found at: ${SNAPSHOT_VHD}`);
        log("  Create one first with: bun scripts/spawn-dev-vm.ts --snapshot <vm-name>");
        log("\n  This check runs before elevation so you see the error immediately.");
        process.exit(1);
      }
      logSuccess(`Snapshot found: ${SNAPSHOT_VHD}`);
    }

    // Check for creating a VM without snapshot - need base VHD or Azure access
    const isCreatingVM =
      !args.includes("--list") &&
      !args.includes("--destroy") &&
      !args.includes("--snapshot") &&
      !args.includes("--setup") &&
      !args.includes("--use-snapshot");
    if (isCreatingVM && !existsSync(CACHE_VHD)) {
      logWarning("Base VHD not cached - will download from Azure (~30GB)");
      log("  This requires Azure CLI login and may take 10-20 minutes.");
    }
  }

  // Check for admin privileges (required for Hyper-V)
  // Skip check for --help
  if (!args.includes("--help") && !args.includes("-h")) {
    const admin = await isAdmin();
    if (!admin) {
      await relaunchAsAdmin();
      return; // Will exit in relaunchAsAdmin
    }
  }

  // Handle --help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  Usage: bun scripts/spawn-dev-vm.ts [options]

  Options:
    --setup              First-time setup (install prerequisites)
    --name <name>        VM name (default: mcp-dev)
    --memory <size>      Startup memory, e.g. 1GB (default: 1GB, dynamic 512MB-4GB)
    --force-download     Re-download VHD from Azure
    --list               List running dev VMs
    --destroy <name>     Destroy a VM
    --snapshot <name>    Save VM as authenticated snapshot
    --use-snapshot       Create VM from authenticated snapshot
    --rdp                Open RDP instead of VNC (new session)
    --no-viewer          Don't auto-open any viewer
    --help, -h           Show this help

  Examples:
    bun scripts/spawn-dev-vm.ts                       # Create default VM
    bun scripts/spawn-dev-vm.ts --name test-vm       # Create named VM
    bun scripts/spawn-dev-vm.ts --list               # List VMs
    bun scripts/spawn-dev-vm.ts --destroy test-vm    # Delete VM
    bun scripts/spawn-dev-vm.ts --snapshot mcp-dev   # Save authenticated VM
    bun scripts/spawn-dev-vm.ts --use-snapshot       # Create from snapshot

  Credentials (from environment variables):
    RDP User: ${VM_USERNAME}
    RDP Pass: (VM_PASSWORD env var)
    VNC Pass: (VNC_PASSWORD env var)
`);
    return;
  }

  // Handle --setup
  if (args.includes("--setup")) {
    await runSetup();
    return;
  }

  // Handle --list
  if (args.includes("--list")) {
    await listVMs();
    return;
  }

  // Handle --destroy
  const destroyIndex = args.indexOf("--destroy");
  if (destroyIndex !== -1) {
    const destroyName = args[destroyIndex + 1] || DEFAULT_VM_NAME;
    await destroyVM(destroyName);
    return;
  }

  // Handle --snapshot
  const snapshotIndex = args.indexOf("--snapshot");
  if (snapshotIndex !== -1) {
    const snapshotVmName = args[snapshotIndex + 1] || DEFAULT_VM_NAME;
    await snapshotVM(snapshotVmName);
    return;
  }

  // Parse other args
  const forceDownload = args.includes("--force-download");
  const useSnapshot = args.includes("--use-snapshot");

  let vmName = DEFAULT_VM_NAME;
  const nameIndex = args.indexOf("--name");
  if (nameIndex !== -1 && args[nameIndex + 1]) {
    vmName = args[nameIndex + 1];
  }

  let memoryMB = DEFAULT_MEMORY_MB;
  const memIndex = args.indexOf("--memory");
  if (memIndex !== -1 && args[memIndex + 1]) {
    const memStr = args[memIndex + 1].toUpperCase();
    memoryMB = parseInt(memStr) * (memStr.includes("GB") ? 1024 : 1);
  }

  // Check prerequisites
  const { ok, status } = await validatePrerequisites();
  if (!ok) {
    process.exit(1);
  }

  // Determine which VHD to use
  let sourceVhd: string | undefined;
  if (useSnapshot) {
    if (!existsSync(SNAPSHOT_VHD)) {
      logError(`No snapshot found at: ${SNAPSHOT_VHD}`);
      log("  Create one first with: bun scripts/spawn-dev-vm.ts --snapshot <vm-name>");
      process.exit(1);
    }
    sourceVhd = SNAPSHOT_VHD;
    logSuccess(`Using authenticated snapshot: ${SNAPSHOT_VHD}`);
  } else {
    // Export from Azure (or use cache)
    await exportFromAzure(forceDownload);
  }

  // Create and start VM
  await createVM(vmName, memoryMB, DEFAULT_CPUS, sourceVhd);

  // Wait for MCP
  const ip = await waitForMCP(vmName);

  // Print connection info
  logStep("VM Ready!");
  console.log(`
  ┌─────────────────────────────────────────────────┐
  │  VM: ${vmName.padEnd(42)}│
  ├─────────────────────────────────────────────────┤
  │  IP:       ${ip.padEnd(36)}│
  │  MCP:      http://${ip}:8080${" ".repeat(Math.max(0, 21 - ip.length))}│
  ├─────────────────────────────────────────────────┤
  │  RDP Credentials:                               │
  │    User: ${VM_USERNAME.padEnd(38)}│
  │    Pass: ${getVmPassword().padEnd(38)}│
  ├─────────────────────────────────────────────────┤
  │  VNC: ${ip}:5900${" ".repeat(Math.max(0, 26 - ip.length))}│
  │    Pass: ${getVncPassword().padEnd(38)}│
  └─────────────────────────────────────────────────┘

  Commands:
    terminator mcp chat --url http://${ip}:8080
    bun scripts/spawn-dev-vm.ts --list
    bun scripts/spawn-dev-vm.ts --destroy ${vmName}
`);

  // Auto-open viewer (VNC by default for persistent console session)
  if (!args.includes("--no-viewer")) {
    if (args.includes("--rdp")) {
      await openRDP(ip);
    } else {
      await openVNC(ip);
    }
  }
}

main().catch(e => {
  console.error("\n  ERROR:", e.message);
  if (e.stderr) console.error("  STDERR:", e.stderr.toString());
  if (e.stdout) console.error("  STDOUT:", e.stdout.toString());
  process.exit(1);
});
