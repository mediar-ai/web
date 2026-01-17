#!/usr/bin/env node
/**
 * Git smudge filter for tauri.conf.json
 * Automatically applies workspace-specific values on checkout
 * Usage: git config filter.tauri-config.smudge "node scripts/git-filters/tauri-config-smudge.js"
 */

const fs = require('fs');
const path = require('path');

// Read from stdin
let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    // Auto-detect workspace variant from folder name
    const cwd = process.cwd();
    let workspaceVariant;

    if (cwd.includes('mediar-app_4')) {
      workspaceVariant = 'dev4';
    } else if (cwd.includes('mediar-app_3')) {
      workspaceVariant = 'dev3';
    } else if (cwd.includes('mediar-app_2')) {
      workspaceVariant = 'dev2';
    } else if (cwd.includes('mediar-app')) {
      // Base workspace - check env var or default to 'dev'
      workspaceVariant = process.env.MEDIAR_WORKSPACE_VARIANT || 'dev';
    } else {
      // Fallback to env var if folder pattern doesn't match
      workspaceVariant = process.env.MEDIAR_WORKSPACE_VARIANT;
    }

    // If no workspace variant or production, pass through unchanged to preserve formatting
    if (!workspaceVariant || workspaceVariant === 'production') {
      process.stdout.write(input);
      return;
    }

    // Replace values using regex to preserve original formatting
    let output = input;

    // Replace productName with workspace variant
    output = output.replace(
      /"productName":\s*"mediar[^"]*"/,
      `"productName": "mediar-${workspaceVariant}"`
    );

    // Replace identifier with workspace variant
    output = output.replace(
      /"identifier":\s*"ai\.mediar\.desktop[^"]*"/,
      `"identifier": "ai.mediar.desktop.${workspaceVariant}"`
    );

    // Replace devUrl with workspace-specific port (dev1=1421, dev2=1422, etc.)
    const portNumber = workspaceVariant === 'dev' ? 1420 : (parseInt(workspaceVariant.replace(/\D/g, '')) || 0) + 1420;
    output = output.replace(
      /"devUrl":\s*"http:\/\/localhost:\d+"/,
      `"devUrl": "http://localhost:${portNumber}"`
    );

    // Output to stdout (git will write this to working directory)
    process.stdout.write(output);
  } catch (error) {
    // If replacement fails, pass through unchanged
    process.stderr.write(`Error in smudge filter: ${error.message}\n`);
    process.stdout.write(input);
    process.exit(0);
  }
});
