#!/usr/bin/env node

/**
 * Detailed comparison of add_adjustments.js between GitHub and Storage
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

async function detailedComparison() {
  console.log('=== DETAILED COMPARISON OF add_adjustments.js ===\n');

  try {
    // 1. Fetch from GitHub
    console.log('1. GITHUB VERSION:\n');
    console.log('=' .repeat(80));
    const { data: githubFile } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: `${WORKFLOW_FOLDER}/${FILE_NAME}`,
      ref: 'main'
    });

    if (!('content' in githubFile)) {
      throw new Error('Not a file');
    }

    const githubContent = Buffer.from(githubFile.content, 'base64').toString();
    const githubHash = crypto.createHash('md5').update(githubContent).digest('hex');

    console.log(`File: ${WORKFLOW_FOLDER}/${FILE_NAME}`);
    console.log(`Size: ${githubContent.length} bytes`);
    console.log(`MD5: ${githubHash}`);
    console.log(`GitHub SHA: ${githubFile.sha}`);
    console.log(`\nFull Content (first 3000 chars):\n`);
    console.log(githubContent.substring(0, 3000));
    console.log('\n... [truncated]');

    // Search for key patterns
    console.log('\n📊 GitHub Version Analysis:');
    console.log('-'.repeat(40));

    // Count occurrences
    const githubAdjustmentCount = (githubContent.match(/adjustment/gi) || []).length;
    const github441500Count = (githubContent.match(/441500/g) || []).length;
    const githubGLCount = (githubContent.match(/GL_ACCOUNT/g) || []).length;

    console.log(`  "adjustment" appears: ${githubAdjustmentCount} times`);
    console.log(`  "441500" appears: ${github441500Count} times`);
    console.log(`  "GL_ACCOUNT" appears: ${githubGLCount} times`);

    // Look for specific lines
    const githubLines = githubContent.split('\n');
    githubLines.forEach((line, index) => {
      if (line.includes('441500') || line.includes('GL_ACCOUNT')) {
        console.log(`  Line ${index + 1}: ${line.trim().substring(0, 80)}`);
      }
    });

    // 2. Fetch from Storage
    console.log('\n\n2. STORAGE VERSION:\n');
    console.log('=' .repeat(80));
    const storagePath = `${WORKFLOW_ID}/${VERSION}/${FILE_NAME}`;

    const { data: storageData, error: downloadError } = await supabase.storage
      .from('workflow-files')
      .download(storagePath);

    if (downloadError) {
      console.error(`❌ Download failed: ${downloadError.message}`);
      return;
    }

    const storageContent = Buffer.from(await storageData.arrayBuffer()).toString();
    const storageHash = crypto.createHash('md5').update(storageContent).digest('hex');

    console.log(`Path: ${storagePath}`);
    console.log(`Size: ${storageContent.length} bytes`);
    console.log(`MD5: ${storageHash}`);
    console.log(`\nFull Content (first 3000 chars):\n`);
    console.log(storageContent.substring(0, 3000));
    console.log('\n... [truncated]');

    // Search for key patterns
    console.log('\n📊 Storage Version Analysis:');
    console.log('-'.repeat(40));

    const storageAdjustmentCount = (storageContent.match(/adjustment/gi) || []).length;
    const storage441500Count = (storageContent.match(/441500/g) || []).length;
    const storageGLCount = (storageContent.match(/GL_ACCOUNT/g) || []).length;

    console.log(`  "adjustment" appears: ${storageAdjustmentCount} times`);
    console.log(`  "441500" appears: ${storage441500Count} times`);
    console.log(`  "GL_ACCOUNT" appears: ${storageGLCount} times`);

    // Look for specific lines
    const storageLines = storageContent.split('\n');
    storageLines.forEach((line, index) => {
      if (line.includes('441500') || line.includes('GL_ACCOUNT')) {
        console.log(`  Line ${index + 1}: ${line.trim().substring(0, 80)}`);
      }
    });

    // 3. DETAILED COMPARISON
    console.log('\n\n3. COMPARISON:\n');
    console.log('=' .repeat(80));

    if (githubHash === storageHash) {
      console.log('✅ FILES ARE IDENTICAL (Same MD5 hash)');
    } else {
      console.log('❌ FILES ARE DIFFERENT');
      console.log(`\nHash Comparison:`);
      console.log(`  GitHub:  ${githubHash}`);
      console.log(`  Storage: ${storageHash}`);

      // Byte-by-byte comparison
      console.log(`\nSize Comparison:`);
      console.log(`  GitHub:  ${githubContent.length} bytes`);
      console.log(`  Storage: ${storageContent.length} bytes`);
      console.log(`  Difference: ${Math.abs(githubContent.length - storageContent.length)} bytes`);

      // Find first difference
      console.log('\nFinding differences...\n');

      const minLength = Math.min(githubContent.length, storageContent.length);
      let firstDiffPos = -1;

      for (let i = 0; i < minLength; i++) {
        if (githubContent[i] !== storageContent[i]) {
          firstDiffPos = i;
          break;
        }
      }

      if (firstDiffPos >= 0) {
        console.log(`First difference at byte position: ${firstDiffPos}`);
        console.log(`GitHub byte: ${githubContent.charCodeAt(firstDiffPos)} (${githubContent[firstDiffPos]})`);
        console.log(`Storage byte: ${storageContent.charCodeAt(firstDiffPos)} (${storageContent[firstDiffPos]})`);

        // Show context around difference
        const start = Math.max(0, firstDiffPos - 50);
        const end = Math.min(firstDiffPos + 50, minLength);

        console.log('\nContext around first difference:');
        console.log('GitHub:  ...' + githubContent.substring(start, end).replace(/\n/g, '\\n') + '...');
        console.log('Storage: ...' + storageContent.substring(start, end).replace(/\n/g, '\\n') + '...');
      }

      // Line-by-line comparison
      console.log('\nLine-by-line differences (first 5):');
      let diffCount = 0;
      const maxLines = Math.max(githubLines.length, storageLines.length);

      for (let i = 0; i < maxLines && diffCount < 5; i++) {
        const githubLine = githubLines[i] || '';
        const storageLine = storageLines[i] || '';

        if (githubLine !== storageLine) {
          diffCount++;
          console.log(`\nLine ${i + 1}:`);
          console.log(`  GitHub:  "${githubLine.substring(0, 80)}"`);
          console.log(`  Storage: "${storageLine.substring(0, 80)}"`);
        }
      }

      if (diffCount === 0) {
        console.log('No line differences found (files might differ in line endings only)');
      }
    }

    // 4. Check line endings
    console.log('\n\n4. LINE ENDING ANALYSIS:\n');
    console.log('=' .repeat(80));

    const githubCRLF = (githubContent.match(/\r\n/g) || []).length;
    const githubLF = (githubContent.match(/(?<!\r)\n/g) || []).length;
    const storageCRLF = (storageContent.match(/\r\n/g) || []).length;
    const storageLF = (storageContent.match(/(?<!\r)\n/g) || []).length;

    console.log('GitHub line endings:');
    console.log(`  CRLF (\\r\\n): ${githubCRLF}`);
    console.log(`  LF (\\n): ${githubLF}`);

    console.log('\nStorage line endings:');
    console.log(`  CRLF (\\r\\n): ${storageCRLF}`);
    console.log(`  LF (\\n): ${storageLF}`);

    if (githubCRLF !== storageCRLF || githubLF !== storageLF) {
      console.log('\n⚠️  LINE ENDING MISMATCH DETECTED');
      console.log('This could be the source of the difference');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

// Run comparison
detailedComparison()
  .then(() => {
    console.log('\n=== END OF COMPARISON ===');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });