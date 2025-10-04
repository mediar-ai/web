import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';

// Load env
dotenv.config({ path: '../.env.local' });

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

async function testGitHubDeletion() {
  const owner = 'mediar-ai';
  const repo = 'workflows';
  const testFilePath = 'testingstuff/test-delete-octokit.txt';

  try {
    console.log('Step 1: Creating test file via Octokit...');
    console.log('='.repeat(80));

    const createResponse = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: testFilePath,
      message: 'Test: Create file for Octokit deletion test',
      content: Buffer.from('This is a test file for Octokit deletion').toString('base64')
    });

    console.log(`✓ File created: ${createResponse.data.content?.path}`);
    console.log(`  SHA: ${createResponse.data.content?.sha}`);
    console.log(`  Commit: ${createResponse.data.commit.sha}`);
    console.log();

    const fileSha = createResponse.data.content?.sha;
    if (!fileSha) {
      throw new Error('No SHA returned from create');
    }

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Step 2: Deleting file via Octokit...');
    console.log('='.repeat(80));

    const deleteResponse = await octokit.repos.deleteFile({
      owner,
      repo,
      path: testFilePath,
      message: 'Test: Delete test file via Octokit',
      sha: fileSha
    });

    console.log(`✓ File deleted successfully!`);
    console.log(`  Commit SHA: ${deleteResponse.data.commit?.sha}`);
    console.log(`  Commit message: ${deleteResponse.data.commit?.message}`);
    console.log(`  Author: ${deleteResponse.data.commit?.author?.name}`);
    console.log();

    // Verify deletion
    console.log('Step 3: Verifying file is deleted...');
    console.log('='.repeat(80));

    try {
      await octokit.repos.getContent({
        owner,
        repo,
        path: testFilePath
      });
      console.log('✗ ERROR: File still exists!');
    } catch (error: any) {
      if (error.status === 404) {
        console.log('✓ Confirmed: File deleted (404 Not Found)');
      } else {
        console.log(`Unexpected error: ${error.message}`);
      }
    }

  } catch (error: any) {
    console.error('Error during test:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testGitHubDeletion();
