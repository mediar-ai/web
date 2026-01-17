#!/usr/bin/env node
/**
 * Git clean filter for tauri.conf.json
 * Ensures production values are always committed to repository
 * Usage: git config filter.tauri-config.clean "node scripts/git-filters/tauri-config-clean.js"
 */

const fs = require('fs');

// Read from stdin
let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  try {
    // Replace values using regex to preserve original formatting
    let output = input;

    // Replace productName (handles both dev variants and production)
    output = output.replace(
      /"productName":\s*"mediar[^"]*"/,
      '"productName": "mediar"'
    );

    // Replace identifier (handles both dev variants and production)
    output = output.replace(
      /"identifier":\s*"ai\.mediar\.desktop[^"]*"/,
      '"identifier": "ai.mediar.desktop"'
    );

    // Replace devUrl to production port
    output = output.replace(
      /"devUrl":\s*"http:\/\/localhost:\d+"/,
      '"devUrl": "http://localhost:1420"'
    );

    // Output to stdout (git will commit this version)
    process.stdout.write(output);
  } catch (error) {
    // If replacement fails, pass through unchanged
    process.stderr.write(`Error in clean filter: ${error.message}\n`);
    process.stdout.write(input);
    process.exit(0);
  }
});
