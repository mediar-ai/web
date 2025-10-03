#!/usr/bin/env node

/**
 * Compare add_adjustments.js between GitHub and Supabase storage
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

const WORKFLOW_ID = 71;
const WORKFLOW_FOLDER = 'ExampleClient_1';
const FILE_NAME = 'add_adjustments.js';
const VERSION = '1.0.15';

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize GitHub
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || process.env.GITHUB_WORKFLOW_TOKEN,
  userAgent: 'mediar-compare'
});

async function compareFiles() {
  console.log('=== Comparing add_adjustments.js ===\n');

  try {
    // 1. Fetch from GitHub
    console.log('1. Fetching from GitHub...');
    const { data: githubFile } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: `${WORKFLOW_FOLDER}/${FILE_NAME}`,
      ref: 'main'
    });

    if (!('content' in githubFile)) {
      throw new Error('Not a file');
    }

    const githubContent = Buffer.from(githubFile.content, 'base64');
    const githubHash = crypto.createHash('md5').update(githubContent).digest('hex');

    console.log(`   Size: ${githubContent.length} bytes`);
    console.log(`   MD5: ${githubHash}`);
    console.log(`   SHA: ${githubFile.sha.substring(0, 7)}`);

    // Show first few lines
    const githubLines = githubContent.toString().split('\n');
    console.log('\n   First 10 lines:');
    githubLines.slice(0, 10).forEach((line, i) => {
      console.log(`   ${(i + 1).toString().padStart(2)}: ${line.substring(0, 70)}`);
    });

    // Check for "adjustment" keyword
    const githubText = githubContent.toString();
    const adjustmentCount = (githubText.match(/adjustment/gi) || []).length;
    console.log(`\n   Contains "adjustment": ${adjustmentCount} times`);

    // Look for specific content
    if (githubText.includes('441500')) {
      console.log('   ✅ Contains "441500" adjustment amount');
    }
    if (githubText.includes('Add adjustment entries')) {
      console.log('   ✅ Contains "Add adjustment entries" text');
    }

    // 2. Fetch from Storage
    console.log('\n2. Fetching from Supabase Storage...');
    const storagePath = `${WORKFLOW_ID}/${VERSION}/${FILE_NAME}`;

    const { data: storageData, error: downloadError } = await supabase.storage
      .from('workflow-files')
      .download(storagePath);

    if (downloadError) {
      console.error(`   ❌ Download failed: ${downloadError.message}`);
      return;
    }

    const storageContent = Buffer.from(await storageData.arrayBuffer());
    const storageHash = crypto.createHash('md5').update(storageContent).digest('hex');

    console.log(`   Size: ${storageContent.length} bytes`);
    console.log(`   MD5: ${storageHash}`);

    // Show first few lines
    const storageLines = storageContent.toString().split('\n');
    console.log('\n   First 10 lines:');
    storageLines.slice(0, 10).forEach((line, i) => {
      console.log(`   ${(i + 1).toString().padStart(2)}: ${line.substring(0, 70)}`);
    });

    // 3. Compare
    console.log('\n3. Comparison Results:');
    console.log('   ' + '='.repeat(50));

    if (githubHash === storageHash) {
      console.log('   ✅ FILES ARE IDENTICAL');
      console.log('   Both files have the same MD5 hash');
    } else {
      console.log('   ❌ FILES ARE DIFFERENT');
      console.log(`   GitHub MD5:  ${githubHash}`);
      console.log(`   Storage MD5: ${storageHash}`);

      // Find differences
      if (githubContent.length !== storageContent.length) {
        console.log(`\n   Size difference:`);
        console.log(`   - GitHub:  ${githubContent.length} bytes`);
        console.log(`   - Storage: ${storageContent.length} bytes`);
      }

      // Line-by-line comparison for first difference
      console.log('\n   First difference found:');
      for (let i = 0; i < Math.min(githubLines.length, storageLines.length); i++) {
        if (githubLines[i] !== storageLines[i]) {
          console.log(`   Line ${i + 1}:`);
          console.log(`   GitHub:  ${githubLines[i].substring(0, 60)}`);
          console.log(`   Storage: ${storageLines[i].substring(0, 60)}`);
          break;
        }
      }
    }

    // 4. Check public URL
    console.log('\n4. Storage Access:');
    const { data: publicUrl } = supabase.storage
      .from('workflow-files')
      .getPublicUrl(storagePath);

    if (publicUrl) {
      console.log(`   Storage path: ${storagePath}`);
      console.log('   File is accessible in storage');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

// Run comparison
compareFiles()
  .then(() => {
    console.log('\n=== Comparison Complete ===');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });