#!/usr/bin/env node
/**
 * Download Visual C++ Redistributables for bundling with Tauri installer
 *
 * Downloads both x64 and ARM64 versions of the VC++ 2015-2022 Redistributables
 * These are required for the terminator-mcp-agent to execute JavaScript/TypeScript.
 */

import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'fs';
import { get } from 'https';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Script is in scripts/ folder, go up one level to project root
const PROJECT_ROOT = join(__dirname, '..');
const VCREDIST_DIR = join(PROJECT_ROOT, 'src-tauri', 'vcredist');
const VCREDIST_URLS = {
  x64: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
  arm64: 'https://aka.ms/vs/17/release/vc_redist.arm64.exe'
};

const DOWNLOAD_TIMEOUT = 60000; // 60 seconds
const MAX_RETRIES = 3;

function downloadFile(url, dest, retries = 0) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...${retries > 0 ? ` (attempt ${retries + 1}/${MAX_RETRIES})` : ''}`);
    const file = createWriteStream(dest);
    let timeout;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      file.close();
      try {
        if (existsSync(dest)) unlinkSync(dest);
      } catch (e) {
        // Ignore cleanup errors
      }
    };

    // Set timeout
    timeout = setTimeout(() => {
      cleanup();
      if (retries < MAX_RETRIES - 1) {
        console.log(`⏱️  Download timed out, retrying...`);
        downloadFile(url, dest, retries + 1).then(resolve).catch(reject);
      } else {
        reject(new Error(`Download timed out after ${MAX_RETRIES} attempts`));
      }
    }, DOWNLOAD_TIMEOUT);

    const request = get(url, (response) => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        cleanup();
        console.log(`Following redirect to ${response.headers.location}`);
        downloadFile(response.headers.location, dest, retries).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        cleanup();
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        clearTimeout(timeout);
        file.close();
        console.log(`✓ Downloaded to ${dest}`);
        resolve();
      });

      file.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });

    request.on('error', (err) => {
      cleanup();
      if (retries < MAX_RETRIES - 1) {
        console.log(`❌ Download failed: ${err.message}, retrying...`);
        downloadFile(url, dest, retries + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });

    // Handle socket hang up
    request.on('socket', (socket) => {
      socket.setTimeout(DOWNLOAD_TIMEOUT);
      socket.on('timeout', () => {
        request.destroy();
      });
    });
  });
}

async function main() {
  // Create vcredist directory if it doesn't exist
  if (!existsSync(VCREDIST_DIR)) {
    mkdirSync(VCREDIST_DIR, { recursive: true });
  }

  const x64Path = join(VCREDIST_DIR, 'vc_redist.x64.exe');
  const arm64Path = join(VCREDIST_DIR, 'vc_redist.arm64.exe');

  try {
    // Download x64 version (required)
    if (existsSync(x64Path)) {
      console.log(`✓ x64 redistributable already exists at ${x64Path}`);
    } else {
      await downloadFile(VCREDIST_URLS.x64, x64Path);
    }

    // Download ARM64 version (optional - warn but don't fail)
    if (existsSync(arm64Path)) {
      console.log(`✓ ARM64 redistributable already exists at ${arm64Path}`);
    } else {
      try {
        await downloadFile(VCREDIST_URLS.arm64, arm64Path);
      } catch (error) {
        console.warn(`⚠️  Failed to download ARM64 redistributable: ${error.message}`);
        console.warn('⚠️  ARM64 builds will not include VC++ redistributable');
        console.warn('⚠️  This is non-critical - continuing with build...');
      }
    }

    console.log('\n✓ VC++ Redistributables ready');
    console.log('These will be included in the Tauri installer.');
  } catch (error) {
    console.error('❌ Error downloading required VC++ Redistributables:', error);
    process.exit(1);
  }
}

main();
