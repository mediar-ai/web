#!/usr/bin/env node

/**
 * Upload all JS files for workflow 71 to Supabase storage
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { Octokit } = require('@octokit/rest');
const crypto = require('crypto');

const WORKFLOW_ID = 71;
const WORKFLOW_FOLDER = 'ExampleClient_1';
const VERSION = '1.0.15';

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize GitHub
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || process.env.GITHUB_WORKFLOW_TOKEN,
  userAgent: 'mediar-upload'
});

async function uploadAllFiles() {
  console.log('=== Uploading All Files for Workflow 71 ===\n');

  try {
    // Fetch all JS files from GitHub
    console.log('Fetching files from GitHub...');
    const { data: contents } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: WORKFLOW_FOLDER,
      ref: 'main'
    });

    const jsFiles = contents.filter(f => f.type === 'file' && f.name.endsWith('.js'));
    console.log(`Found ${jsFiles.length} JS files\n`);

    let uploadedCount = 0;
    let errorCount = 0;

    // Upload each file
    for (const fileInfo of jsFiles) {
      console.log(`Processing ${fileInfo.name}...`);

      try {
        // Fetch file content
        const { data: fileData } = await octokit.repos.getContent({
          owner: 'mediar-ai',
          repo: 'workflows',
          path: fileInfo.path,
          ref: 'main'
        });

        if ('content' in fileData) {
          const content = Buffer.from(fileData.content, 'base64');
          const storagePath = `${WORKFLOW_ID}/${VERSION}/${fileInfo.name}`;
          const fileHash = crypto.createHash('md5').update(content).digest('hex');

          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from('workflow-files')
            .upload(storagePath, content, {
              contentType: 'application/javascript',
              upsert: true
            });

          if (uploadError) {
            console.error(`  ❌ Upload failed: ${uploadError.message}`);
            errorCount++;
          } else {
            console.log(`  ✅ Uploaded to: ${storagePath}`);
            uploadedCount++;

            // Try to save to database (might fail due to schema)
            const { error: dbError } = await supabase
              .from('workflow_files')
              .insert({
                workflow_id: WORKFLOW_ID,
                file_path: fileInfo.name,
                storage_path: storagePath,
                file_size: content.length,
                file_hash: fileHash,
                version_number: VERSION
              });

            if (dbError) {
              console.log(`  ⚠️  Database insert failed (expected): ${dbError.message}`);
            }
          }
        }
      } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        errorCount++;
      }
    }

    // Update workflow files_config
    console.log('\nUpdating workflow files_config...');
    const totalSize = jsFiles.reduce((sum, f) => sum + f.size, 0);

    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        requires_files: true,
        files_config: {
          file_count: jsFiles.length,
          total_size: totalSize,
          subdirectory: null,
          last_updated: new Date().toISOString()
        }
      })
      .eq('id', WORKFLOW_ID);

    if (updateError) {
      console.error('Failed to update workflow:', updateError.message);
    } else {
      console.log('✅ Workflow files_config updated');
    }

    console.log('\n=== Summary ===');
    console.log(`Successfully uploaded: ${uploadedCount}/${jsFiles.length} files`);
    if (errorCount > 0) {
      console.log(`Errors: ${errorCount}`);
    }

    // List uploaded files
    console.log('\nFiles now in storage:');
    const { data: files, error: listError } = await supabase.storage
      .from('workflow-files')
      .list(`${WORKFLOW_ID}/${VERSION}`, {
        limit: 100
      });

    if (files && !listError) {
      files.forEach(f => {
        console.log(`  - ${f.name}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
  }
}

// Run the upload
uploadAllFiles()
  .then(() => {
    console.log('\n✅ Upload complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });