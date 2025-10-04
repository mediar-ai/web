import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env.local' });

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

async function testMultipleFileDeletion() {
  const owner = 'mediar-ai';
  const repo = 'workflows';
  const testFolder = 'testingstuff';

  try {
    console.log('Test: Deleting multiple files from a folder');
    console.log('='.repeat(80));
    console.log();

    // Step 1: Create multiple test files
    console.log('Step 1: Creating 3 test files...');
    const filesToCreate = ['test1.js', 'test2.js', 'test3.js'];
    const createdFiles: Array<{ path: string; sha: string }> = [];

    for (const filename of filesToCreate) {
      const path = `${testFolder}/${filename}`;
      const response = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: `Test: Create ${filename}`,
        content: Buffer.from(`// Test file ${filename}`).toString('base64')
      });

      createdFiles.push({
        path,
        sha: response.data.content?.sha || ''
      });
      console.log(`  ✓ Created: ${path}`);
    }
    console.log();

    // Step 2: Get all files in folder to verify
    console.log('Step 2: Listing all files in folder...');
    const folderContents = await octokit.repos.getContent({
      owner,
      repo,
      path: testFolder
    });

    if (Array.isArray(folderContents.data)) {
      console.log(`  Found ${folderContents.data.length} files in ${testFolder}/:`);
      folderContents.data.forEach(file => {
        console.log(`    - ${file.name} (${file.type})`);
      });
    }
    console.log();

    // Step 3: Delete all test files
    console.log('Step 3: Deleting test files...');
    let deleteCount = 0;
    const startTime = Date.now();

    for (const file of createdFiles) {
      const deleteResponse = await octokit.repos.deleteFile({
        owner,
        repo,
        path: file.path,
        message: `Test: Delete ${file.path.split('/').pop()}`,
        sha: file.sha
      });
      deleteCount++;
      console.log(`  ✓ Deleted: ${file.path} (commit: ${deleteResponse.data.commit?.sha?.substring(0, 8)})`);
    }

    const duration = Date.now() - startTime;
    console.log();
    console.log(`Deleted ${deleteCount} files in ${duration}ms (avg ${Math.round(duration/deleteCount)}ms per file)`);
    console.log();

    // Step 4: Verify files are gone
    console.log('Step 4: Verifying deletions...');
    let verifiedCount = 0;
    for (const file of createdFiles) {
      try {
        await octokit.repos.getContent({
          owner,
          repo,
          path: file.path
        });
        console.log(`  ✗ ERROR: ${file.path} still exists!`);
      } catch (error: any) {
        if (error.status === 404) {
          verifiedCount++;
          console.log(`  ✓ Confirmed deleted: ${file.path}`);
        }
      }
    }

    console.log();
    console.log(`Summary: ${verifiedCount}/${createdFiles.length} files successfully deleted`);

  } catch (error: any) {
    console.error('Error during test:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testMultipleFileDeletion();
