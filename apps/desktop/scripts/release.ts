#!/usr/bin/env bun
/**
 * Mediar Release Script
 * Build, sign, and upload to CrabNebula Cloud
 *
 * Usage:
 *   bun scripts/release.ts [--full|--staging]
 *
 * ============================================
 * FIRST-TIME SETUP
 * ============================================
 *
 * 1. SSL.com Credentials (~\SSL.com\.env)
 *    - Get the .env file from Louis or another team member
 *    - Place at: C:\Users\<you>\SSL.com\.env
 *    - Or set MEDIAR_SSL_DIR env var to custom location
 *    - Required variables:
 *      ESIGNER_USERNAME, ESIGNER_PIN, ESIGNER_TOTP_SECRET, ESIGNER_CREDENTIAL_ALIAS
 *      TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD
 *      CN_API_KEY
 *
 * 2. Project .env (optional)
 *    - SENTRY_AUTH_TOKEN: For uploading source maps to Sentry
 *
 * 3. CodeSignTool (%LOCALAPPDATA%\CodeSignTool)
 *    - Download: https://www.ssl.com/download/codesigntool-for-windows/
 *    - Extract to: C:\Users\<you>\AppData\Local\CodeSignTool
 *    - Should contain: jdk-11.0.2\, jar\code_sign_tool-1.3.2.jar
 *
 * 4. CrabNebula CLI (cn.exe)
 *    - Download: https://cdn.crabnebula.app/download/crabnebula/cn-cli/latest/cn_windows.exe
 *    - Rename to cn.exe and place in: C:\Users\<you>\bin\ (or add to PATH)
 *
 * ============================================
 */

import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from "fs";
import { join, basename } from "path";
import { homedir, tmpdir } from "os";

// ============================================
// Config
// ============================================
const VARIANT = process.argv.includes("--staging") ? "staging" : "full";
const WORKSPACE = process.cwd();
const HOME = homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");

// ============================================
// Path Detection
// ============================================
function findPath(candidates: string[], name: string): string {
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  throw new Error(`${name} not found. Checked: ${candidates.filter(Boolean).join(", ")}`);
}

const SSL_DIR = findPath(
  [process.env.MEDIAR_SSL_DIR, join(HOME, "SSL.com"), join(HOME, "Documents", "SSL.com")],
  "SSL.com directory"
);

const CODE_SIGN_TOOL = findPath(
  [join(LOCALAPPDATA, "CodeSignTool"), join(HOME, "CodeSignTool"), "C:\\CodeSignTool"],
  "CodeSignTool"
);

async function findCnExe(): Promise<string> {
  // Check PATH
  try {
    const result = await $`where cn.exe`.quiet();
    if (result.exitCode === 0) return result.stdout.toString().trim().split("\n")[0];
  } catch {}

  // Check common locations
  const candidates = [join(HOME, "bin", "cn.exe"), join(LOCALAPPDATA, "CrabNebula", "cn.exe")];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("cn.exe not found. Install CrabNebula CLI.");
}

// ============================================
// Load .env
// ============================================
function loadEnv(path: string): Record<string, string> {
  const content = readFileSync(path, "utf-8");
  const env: Record<string, string> = {};
  // Handle both CRLF and LF line endings
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

// ============================================
// Main
// ============================================
async function main() {
  console.log("========================================");
  console.log("Mediar Release Script");
  console.log("========================================");
  console.log(`Variant: ${VARIANT}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`SSL.com: ${SSL_DIR}`);
  console.log(`CodeSignTool: ${CODE_SIGN_TOOL}`);

  const CN_EXE = await findCnExe();
  console.log(`cn.exe: ${CN_EXE}`);
  console.log("");

  // Load credentials
  const envPath = join(SSL_DIR, ".env");
  if (!existsSync(envPath)) throw new Error(`.env not found at ${envPath}`);
  const creds = loadEnv(envPath);

  const CN_APP = VARIANT === "full" ? "mediarai/mediar" : "mediarai/mediar-staging";

  // Validate RELEASE_NOTES.md
  const releaseNotesPath = join(WORKSPACE, "RELEASE_NOTES.md");
  if (!existsSync(releaseNotesPath)) {
    throw new Error("RELEASE_NOTES.md not found. Create it with changelog first.");
  }
  const releaseNotes = readFileSync(releaseNotesPath, "utf-8").trim();
  if (!releaseNotes) throw new Error("RELEASE_NOTES.md is empty.");
  console.log("✓ RELEASE_NOTES.md found\n");

  // ========================================
  // Step 1: Prepare Tauri Config
  // ========================================
  console.log("========================================");
  console.log("Step 1: Preparing Tauri Config");
  console.log("========================================\n");

  const tauriConfig = join(WORKSPACE, "src-tauri", "tauri.conf.json");
  const tauriBackup = join(WORKSPACE, "src-tauri", "tauri.conf.json.backup");
  const variantConfig = join(
    WORKSPACE,
    "src-tauri",
    VARIANT === "full" ? "tauri.conf.prod.json" : "tauri.conf.staging.json"
  );

  if (!existsSync(variantConfig)) throw new Error(`Variant config not found: ${variantConfig}`);

  copyFileSync(tauriConfig, tauriBackup);
  copyFileSync(variantConfig, tauriConfig);
  console.log(`✓ Using ${VARIANT} config`);

  // Check if release binary needs rebuild due to identifier mismatch
  // Tauri embeds identifier at compile time - changing config doesn't trigger rebuild
  const releaseBinary = join(WORKSPACE, "target", "release", "mediar.exe");
  const releaseMarker = join(WORKSPACE, "target", "release", ".tauri-identifier");

  const configContent = readFileSync(tauriConfig, "utf-8");
  const identifierMatch = configContent.match(/"identifier":\s*"([^"]+)"/);
  const currentIdentifier = identifierMatch?.[1] || "";

  if (existsSync(releaseBinary) && currentIdentifier) {
    let lastIdentifier = "";
    if (existsSync(releaseMarker)) {
      lastIdentifier = readFileSync(releaseMarker, "utf-8").trim();
    }

    if (lastIdentifier && lastIdentifier !== currentIdentifier) {
      console.log(`  ⚠️  Identifier changed: ${lastIdentifier} → ${currentIdentifier}`);
      rmSync(releaseBinary, { force: true });
      console.log(`  ✓ Deleted release binary to force rebuild`);
    }
  }

  // Update marker with current identifier
  try {
    const releaseDir = join(WORKSPACE, "target", "release");
    if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });
    writeFileSync(releaseMarker, currentIdentifier);
  } catch {
    // Target dir might not exist yet
  }

  console.log("");

  // ========================================
  // Step 2: Build
  // ========================================
  console.log("========================================");
  console.log("Step 2: Building Tauri Installer");
  console.log("========================================\n");

  try {
    await $`bun run build:tauri`.env({
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: creds.TAURI_SIGNING_PRIVATE_KEY,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: creds.TAURI_SIGNING_PRIVATE_KEY_PASSWORD,
    });
    console.log("✓ Build completed\n");
  } catch (e) {
    // Restore config on failure
    copyFileSync(tauriBackup, tauriConfig);
    rmSync(tauriBackup);
    throw e;
  }

  // ========================================
  // Step 2.5: Upload Source Maps to Sentry
  // ========================================
  console.log("========================================");
  console.log("Step 2.5: Uploading Source Maps to Sentry");
  console.log("========================================\n");

  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  if (sentryToken) {
    const sentryProject = VARIANT === "full" ? "mediar-desktop" : "mediar-desktop";
    try {
      await $`bunx @sentry/cli sourcemaps upload --org mediar-n5 --project ${sentryProject} ./dist`.env({
        ...process.env,
        SENTRY_AUTH_TOKEN: sentryToken,
      });
      console.log("✓ Source maps uploaded to Sentry\n");
    } catch (e) {
      console.warn("⚠ Source map upload failed (non-fatal):", (e as Error).message);
      console.log("");
    }
  } else {
    console.log("⚠ SENTRY_AUTH_TOKEN not set, skipping source map upload");
    console.log("  Add SENTRY_AUTH_TOKEN to .env to enable\n");
  }

  // ========================================
  // Step 3: Create Draft Release
  // ========================================
  console.log("========================================");
  console.log("Step 3: Creating Draft Release");
  console.log("========================================\n");

  await $`${CN_EXE} release draft ${CN_APP} --framework tauri --notes-file ${releaseNotesPath}`.env({
    ...process.env,
    CN_API_KEY: creds.CN_API_KEY,
  });
  console.log("✓ Draft release created\n");

  // ========================================
  // Step 4: Sign Installer
  // ========================================
  console.log("========================================");
  console.log("Step 4: Signing Installer");
  console.log("========================================\n");

  const bundlePath = join(WORKSPACE, "target", "release", "bundle", "nsis");
  const pattern = VARIANT === "full" ? /^mediar_.*_x64-setup\.exe$/ : /^mediar-staging_.*_x64-setup\.exe$/;

  const files = (await Array.fromAsync(new Bun.Glob("*.exe").scan(bundlePath))).filter(f => pattern.test(f));

  if (files.length === 0) throw new Error(`No installer found in ${bundlePath}`);
  const installerName = files[0];
  const installerPath = join(bundlePath, installerName);
  console.log(`Found: ${installerName}`);

  const javaPath = join(CODE_SIGN_TOOL, "jdk-11.0.2", "bin", "java.exe");
  const jarPath = join(CODE_SIGN_TOOL, "jar", "code_sign_tool-1.3.2.jar");
  const signedDir = join(CODE_SIGN_TOOL, "signed");

  if (existsSync(signedDir)) rmSync(signedDir, { recursive: true });
  mkdirSync(signedDir);

  const signCmd = [
    javaPath,
    "-jar",
    jarPath,
    "sign",
    `-username=${creds.ESIGNER_USERNAME}`,
    `-password=${creds.ESIGNER_PIN}`,
    `-totp_secret=${creds.ESIGNER_TOTP_SECRET}`,
    `-credential_id=${creds.ESIGNER_CREDENTIAL_ALIAS}`,
    `-input_file_path=${installerPath}`,
    `-output_dir_path=${signedDir}`,
  ];

  const signResult = Bun.spawnSync(signCmd, { cwd: CODE_SIGN_TOOL });
  if (signResult.exitCode !== 0) {
    throw new Error(`Signing failed: ${signResult.stderr.toString()}`);
  }

  const signedPath = join(signedDir, installerName);
  if (!existsSync(signedPath)) throw new Error("Signed file not created");

  copyFileSync(signedPath, installerPath);
  console.log("✓ Installer signed\n");

  // ========================================
  // Step 5: Regenerate Tauri .sig
  // ========================================
  console.log("========================================");
  console.log("Step 5: Regenerating Tauri Signature");
  console.log("========================================\n");

  const sigPath = `${installerPath}.sig`;
  if (existsSync(sigPath)) {
    rmSync(sigPath);

    const keyFile = join(tmpdir(), "tauri-key.txt");
    writeFileSync(keyFile, creds.TAURI_SIGNING_PRIVATE_KEY);

    await $`bun run tauri signer sign ${installerPath} --private-key-path ${keyFile} --password ${creds.TAURI_SIGNING_PRIVATE_KEY_PASSWORD}`.env(
      {
        ...process.env,
        TAURI_SIGNING_PRIVATE_KEY: undefined,
        TAURI_PRIVATE_KEY: undefined,
      }
    );

    rmSync(keyFile);
    console.log("✓ Signature regenerated\n");
  }

  // ========================================
  // Step 6: Upload
  // ========================================
  console.log("========================================");
  console.log("Step 6: Uploading to CrabNebula");
  console.log("========================================\n");

  const versionMatch = installerName.match(/mediar.*_([0-9.]+)_.*\.exe/);
  if (!versionMatch) throw new Error("Could not extract version from filename");
  const version = versionMatch[1];
  console.log(`Version: ${version}`);

  const cnEnv = { ...process.env, CN_API_KEY: creds.CN_API_KEY };

  await $`${CN_EXE} release upload ${CN_APP} ${version} --file ${installerPath} --update-platform windows-x86_64 --public-platform windows-x86_64`.env(
    cnEnv
  );
  console.log("✓ Installer uploaded");

  if (existsSync(sigPath)) {
    await $`${CN_EXE} release upload ${CN_APP} ${version} --file ${sigPath}`.env(cnEnv);
    console.log("✓ Signature uploaded");
  }
  console.log("");

  // ========================================
  // Step 7: Publish
  // ========================================
  console.log("========================================");
  console.log("Step 7: Publishing Release");
  console.log("========================================\n");

  if (VARIANT === "staging") {
    await $`${CN_EXE} release publish ${CN_APP} --framework tauri`.env(cnEnv);
    console.log("✓ Staging release published!\n");
  } else {
    console.log("Production release uploaded as DRAFT");
    console.log("→ Manually publish at https://app.crabnebula.cloud/\n");
  }

  // ========================================
  // Step 8: Restore Config
  // ========================================
  copyFileSync(tauriBackup, tauriConfig);
  rmSync(tauriBackup);
  console.log("✓ Dev config restored\n");

  // ========================================
  // Done
  // ========================================
  console.log("========================================");
  console.log("SUCCESS!");
  console.log("========================================");
  console.log(`App: ${CN_APP}`);
  console.log(`Version: ${version}`);
  console.log(`Installer: ${installerPath}`);
  console.log(`Dashboard: https://app.crabnebula.cloud/`);
}

main().catch(e => {
  console.error("\n❌ ERROR:", e.message);
  process.exit(1);
});
