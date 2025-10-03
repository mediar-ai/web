const { Octokit } = require('@octokit/rest');

// Replace with actual token if available
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_WORKFLOW_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('No GitHub token found');
  process.exit(1);
}

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
  userAgent: 'mediar-workflow-test'
});

async function fetchWorkflowFiles(folderName, branch = 'main') {
  try {
    console.log(`\nFetching files from: ${folderName} (branch: ${branch})`);
    
    // Get folder contents from GitHub
    const { data: contents } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: folderName,
      ref: branch
    });

    if (!Array.isArray(contents)) {
      console.log('Not a directory');
      return { jsFiles: [] };
    }

    console.log(`Total files in folder: ${contents.length}`);

    // Filter for JS files
    const jsFileInfos = contents.filter(
      file => file.type === 'file' && file.name.endsWith('.js')
    );

    console.log(`JavaScript files found: ${jsFileInfos.length}`);
    
    if (jsFileInfos.length > 0) {
      console.log('JS files:');
      jsFileInfos.forEach(f => {
        console.log(`  - ${f.name} (${f.size} bytes)`);
      });
    }

    // Check for adjustment file
    const adjustmentFile = jsFileInfos.find(f => f.name.toLowerCase().includes('adjustment'));
    if (adjustmentFile) {
      console.log(`\n✅ Found adjustment file: ${adjustmentFile.name}`);
    } else {
      console.log('\n❌ No adjustment file found');
    }

    return { jsFiles: jsFileInfos };

  } catch (error) {
    console.error('Error fetching files:', error.message);
    if (error.status === 404) {
      console.error('Folder not found in GitHub');
    } else if (error.status === 401) {
      console.error('Authentication failed - check GitHub token');
    }
    return { jsFiles: [] };
  }
}

// Test with imperial_treasure_1
fetchWorkflowFiles('imperial_treasure_1', 'main')
  .then(result => {
    console.log('\n=== Result ===');
    console.log(`Found ${result.jsFiles.length} JS files`);
  })
  .catch(error => {
    console.error('Test failed:', error);
  });
