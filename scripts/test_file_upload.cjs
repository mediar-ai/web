#!/usr/bin/env node

/**
 * Test script to manually upload files for workflow 71
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { Octokit } = require('@octokit/rest');

const WORKFLOW_ID = 71;
const WORKFLOW_FOLDER = 'ExampleClient_1';

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize GitHub
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || process.env.GITHUB_WORKFLOW_TOKEN,
  userAgent: 'mediar-test'
});

async function testFileUpload() {
  console.log('=== Testing File Upload for Workflow 71 ===\n');

  try {
    // Step 1: Check if workflow exists
    console.log('1. Checking workflow in database...');
    const { data: workflow, error: wfError } = await supabase
      .from('deployed_workflows')
      .select('id, name, github_folder, files_config')
      .eq('id', WORKFLOW_ID)
      .single();

    if (wfError) {
      throw new Error(`Workflow not found: ${wfError.message}`);
    }

    console.log(`   Found: ${workflow.name}`);
    console.log(`   GitHub folder: ${workflow.github_folder}`);
    if (workflow.files_config) {
      console.log(`   Current files config:`, workflow.files_config);
    }

    // Step 2: Fetch files from GitHub
    console.log('\n2. Fetching files from GitHub...');
    const { data: contents } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: WORKFLOW_FOLDER,
      ref: 'main'
    });

    if (!Array.isArray(contents)) {
      throw new Error('Not a directory');
    }

    const jsFiles = contents.filter(f => f.type === 'file' && f.name.endsWith('.js'));
    console.log(`   Found ${jsFiles.length} JS files`);

    // List the files
    jsFiles.forEach(f => {
      console.log(`   - ${f.name} (${f.size} bytes)`);
    });

    // Check for adjustment file
    const adjustmentFile = jsFiles.find(f => f.name.toLowerCase().includes('adjustment'));
    if (adjustmentFile) {
      console.log(`   ✅ Found adjustment file: ${adjustmentFile.name}`);
    }

    // Step 3: Check storage bucket
    console.log('\n3. Checking storage bucket...');
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

    if (bucketError) {
      console.error('   Error listing buckets:', bucketError.message);
    } else if (buckets) {
      console.log(`   Found ${buckets.length} buckets:`);
      buckets.forEach(b => console.log(`   - ${b.name}`));

      const workflowBucket = buckets.find(b => b.name === 'workflow-files');
      if (!workflowBucket) {
        console.log('\n   ❌ Bucket "workflow-files" does not exist!');
        console.log('   Creating bucket...');

        const { data: newBucket, error: createError } = await supabase.storage.createBucket('workflow-files', {
          public: false,
          allowedMimeTypes: ['application/javascript', 'text/javascript', 'application/json', 'text/plain']
        });

        if (createError) {
          console.error('   Failed to create bucket:', createError.message);
        } else {
          console.log('   ✅ Bucket created successfully');
        }
      } else {
        console.log('   ✅ Bucket "workflow-files" exists');
      }
    }

    // Step 4: Try to upload one file as a test
    if (jsFiles.length > 0) {
      console.log('\n4. Testing file upload...');
      const testFile = jsFiles[0];
      console.log(`   Uploading ${testFile.name}...`);

      // Fetch file content
      const { data: fileData } = await octokit.repos.getContent({
        owner: 'mediar-ai',
        repo: 'workflows',
        path: testFile.path,
        ref: 'main'
      });

      if ('content' in fileData) {
        const content = Buffer.from(fileData.content, 'base64');
        const storagePath = `${WORKFLOW_ID}/v1.0.15/${testFile.name}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('workflow-files')
          .upload(storagePath, content, {
            contentType: 'application/javascript',
            upsert: true
          });

        if (uploadError) {
          console.error('   Upload failed:', uploadError.message);
        } else {
          console.log('   ✅ Upload successful:', storagePath);

          // Save to workflow_files table
          const { error: dbError } = await supabase
            .from('workflow_files')
            .upsert({
              workflow_id: WORKFLOW_ID,
              file_path: testFile.name,
              storage_path: storagePath,
              file_size: content.length,
              file_hash: require('crypto').createHash('md5').update(content).digest('hex'),
              version_number: '1.0.15',
              uploaded_at: new Date().toISOString()
            });

          if (dbError) {
            console.error('   Failed to save to database:', dbError.message);
          } else {
            console.log('   ✅ Saved to database');
          }
        }
      }
    }

    console.log('\n=== Test Complete ===');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.status === 401) {
      console.error('Authentication failed - check GitHub token');
    } else if (error.status === 404) {
      console.error('GitHub folder not found');
    }
  }
}

// Run the test
testFileUpload()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });