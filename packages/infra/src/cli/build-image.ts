#!/usr/bin/env tsx
/**
 * CLI script to build Azure VM image using Image Builder
 * Run with: npx tsx src/cli/build-image.ts
 */

import { buildImage, checkImageBuilderPrerequisites } from '../azure/image-builder.js';

async function main() {
  console.log('=== Azure Image Builder ===\n');

  // Check required env vars
  const vmPassword = process.env.VM_PASSWORD;
  const vncPassword = process.env.VNC_PASSWORD;
  const s3AccessKey = process.env.S3_ACCESS_KEY;
  const s3SecretKey = process.env.S3_SECRET_KEY;

  if (!vmPassword || !vncPassword) {
    console.error('ERROR: VM_PASSWORD and VNC_PASSWORD environment variables are required');
    process.exit(1);
  }

  // Check Azure credentials
  if (!process.env.AZURE_SUBSCRIPTION_ID) {
    console.error('ERROR: AZURE_SUBSCRIPTION_ID is required');
    process.exit(1);
  }

  console.log('Checking prerequisites...');
  const prereqs = await checkImageBuilderPrerequisites();
  if (!prereqs.ready) {
    console.error('Prerequisites not met:', prereqs.missing);
    console.log('\nSetup instructions:');
    prereqs.instructions.forEach(i => console.log(i));
    process.exit(1);
  }

  console.log('\nStarting image build...');
  console.log('This will take 30-60 minutes.\n');

  const result = await buildImage(
    {
      vmPassword,
      vncPassword,
      s3AccessKey,
      s3SecretKey,
    },
    (progress) => {
      const statusIcon = progress.status === 'completed' ? '✓' : 
                         progress.status === 'failed' ? '✗' : 
                         progress.status === 'in_progress' ? '⏳' : '○';
      console.log(`[${statusIcon}] ${progress.step}: ${progress.message}`);
    }
  );

  if (result.success) {
    console.log('\n=== Build Complete ===');
    console.log(`Template: ${result.templateName}`);
    console.log(`Output: ${result.runOutputId}`);
    process.exit(0);
  } else {
    console.error('\n=== Build Failed ===');
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
