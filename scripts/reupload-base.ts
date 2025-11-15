/**
 * Local Test Script: Manually Populate TypeScript Workflow to Database
 *
 * This script simulates the GitHub webhook process to test TypeScript workflow
 * sync WITHOUT pushing to production.
 *
 * Usage:
 *   bun run scripts/test-typescript-workflow-sync.ts
 */

import { createClient } from '@supabase/supabase-js';
import { parseTypeScriptWorkflow } from '../src/lib/typescript-workflow-parser';
import { promises as fs } from 'fs';
import path from 'path';

// Initialize Supabase client (local dev)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testTypeScriptWorkflowSync() {
  console.log('🧪 Testing TypeScript Workflow Sync Locally\n');

  // ==========================================================================
  // STEP 1: Read TypeScript workflow from local filesystem
  // ==========================================================================
  const workflowPath = '../workflows/org-org_33DH72nPyAInVAh5t8TyIKVdYNw/WORKFLOW_FOLDER';
  const terminatorPath = path.join(workflowPath, 'src', 'terminator.ts');

  console.log(`📂 Reading TypeScript workflow from: ${workflowPath}`);

  let terminatorContent: string;
  try {
    terminatorContent = await fs.readFile(terminatorPath, 'utf-8');
    console.log(`✅ Read terminator.ts (${terminatorContent.length} bytes)`);
  } catch (error) {
    console.error(`❌ Failed to read terminator.ts:`, error);
    process.exit(1);
  }

  // ==========================================================================
  // STEP 2: Parse TypeScript AST to extract metadata
  // ==========================================================================
  console.log(`\n📘 Parsing TypeScript workflow AST...`);

  let metadata: any;
  try {
    metadata = parseTypeScriptWorkflow(terminatorContent);
    console.log(`✅ Parsed workflow metadata:`);
    console.log(`   Name: ${metadata.name}`);
    console.log(`   Version: ${metadata.version}`);
    console.log(`   Description: ${metadata.description}`);
    console.log(`   Inputs: ${metadata.inputs.length}`);
    console.log(`   Steps: ${metadata.steps.length}`);
  } catch (error) {
    console.error(`❌ Failed to parse TypeScript workflow:`, error);
    process.exit(1);
  }

  // ==========================================================================
  // STEP 3: Check if workflow already exists in database
  // ==========================================================================
  const folderName = 'WORKFLOW_FOLDER';
  console.log(`\n🔍 Checking if workflow "${folderName}" exists in database...`);

  const { data: existing } = await supabase
    .from('deployed_workflows')
    .select('id, name, version')
    .eq('github_folder', folderName)
    .single();

  if (existing) {
    console.log(`✅ Found existing workflow: ID ${existing.id}, name "${existing.name}"`);
    console.log(`\n⚠️  Workflow already exists. Delete it first to test creation, or update version.`);
    console.log(`\n   To delete: run this in Supabase SQL editor:`);
    console.log(`   DELETE FROM deployed_workflows WHERE id = ${existing.id};`);
    process.exit(0);
  }

  console.log(`ℹ️  Workflow not found. Creating new workflow...`);

  // ==========================================================================
  // STEP 4: Create workflow in database
  // ==========================================================================
  console.log(`\n📝 Creating TypeScript workflow in database...`);

  const { data: newWorkflow, error: createError } = await supabase
    .from('deployed_workflows')
    .insert({
      name: metadata.name || 'Imperial Treasure TypeScript Test',
      description: metadata.description,
      status: 'draft',
      preferred_format: 'typescript',
      typescript_metadata: metadata,
      automation_sequence: {}, // Placeholder for NOT NULL constraint
      github_folder: folderName,
      github_path: `org-org_33DH72nPyAInVAh5t8TyIKVdYNw/${folderName}/src/terminator.ts`,
      github_ref: 'main',
      github_sync_status: 'synced',
      github_last_synced_at: new Date().toISOString(),
      version: '1.0.0',
      total_versions: 1,
      organization_id: 'org_2yynzGa53bNM1GTPLp5mc2lYRyD' // Default to your primary org
    })
    .select()
    .single();

  if (createError) {
    console.error(`❌ Failed to create workflow:`, createError);
    process.exit(1);
  }

  console.log(`✅ Created workflow ID: ${newWorkflow.id}`);

  // ==========================================================================
  // STEP 5: Create initial version
  // ==========================================================================
  console.log(`\n📝 Creating initial version 1.0.0...`);

  const { data: initialVersion, error: versionError } = await supabase
    .from('deployed_workflow_versions')
    .insert({
      workflow_id: newWorkflow.id,
      version_number: '1.0.0',
      preferred_format: 'typescript',
      typescript_metadata: metadata,
      automation_sequence: {}, // Placeholder for NOT NULL constraint
      is_active: false,
      change_notes: 'Test workflow created locally'
    })
    .select()
    .single();

  if (versionError) {
    console.error(`❌ Failed to create version:`, versionError);

    // Rollback: Delete the workflow
    await supabase
      .from('deployed_workflows')
      .delete()
      .eq('id', newWorkflow.id);

    process.exit(1);
  }

  console.log(`✅ Created version ID: ${initialVersion.id}`);

  // ==========================================================================
  // STEP 6: Activate version
  // ==========================================================================
  console.log(`\n🔄 Activating version 1.0.0...`);

  const { error: activateError } = await supabase
    .rpc('activate_workflow_version', {
      p_workflow_id: newWorkflow.id,
      p_version_number: '1.0.0'
    });

  if (activateError) {
    console.error(`❌ Failed to activate version:`, activateError);
  } else {
    console.log(`✅ Activated version 1.0.0`);
  }

  // ==========================================================================
  // STEP 7: Update workflow to point to active version
  // ==========================================================================
  await supabase
    .from('deployed_workflows')
    .update({ current_version_id: initialVersion.id })
    .eq('id', newWorkflow.id);

  // ==========================================================================
  // STEP 8: Read and upload TypeScript source files to storage
  // ==========================================================================
  console.log(`\n📦 Reading TypeScript source files from ${workflowPath}...`);

  const tsFiles: Array<{ path: string; content: Buffer }> = [];

  async function collectTsFiles(dir: string, baseDir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        await collectTsFiles(fullPath, baseDir);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const content = await fs.readFile(fullPath);
        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        tsFiles.push({ path: relativePath, content });
        console.log(`   Found: ${relativePath}`);
      }
    }
  }

  await collectTsFiles(workflowPath, workflowPath);

  console.log(`\n✅ Found ${tsFiles.length} TypeScript files`);

  // Upload to Supabase storage
  console.log(`\n📤 Uploading files to Supabase storage...`);

  const WorkflowFileManager = (await import('../src/lib/workflow-file-manager')).WorkflowFileManager;
  const fileManager = new WorkflowFileManager();

  let uploadedCount = 0;
  let totalSize = 0;

  for (const file of tsFiles) {
    const result = await fileManager.uploadWorkflowFiles(
      newWorkflow.id,
      '1.0.0',
      [file],
      undefined
    );

    if (result.success) {
      uploadedCount++;
      totalSize += file.content.length;
      console.log(`   ✓ Uploaded ${file.path}`);
    } else {
      console.error(`   ✗ Failed to upload ${file.path}: ${result.error}`);
    }
  }

  // Update workflow metadata with file info
  if (uploadedCount > 0) {
    await supabase
      .from('deployed_workflows')
      .update({
        requires_files: true,
        files_config: {
          file_count: uploadedCount,
          total_size: totalSize,
          subdirectory: null,
          last_updated: new Date().toISOString()
        }
      })
      .eq('id', newWorkflow.id);

    console.log(`\n✅ Uploaded ${uploadedCount}/${tsFiles.length} files (${(totalSize / 1024).toFixed(2)} KB)`);
  }

  // ==========================================================================
  // DONE
  // ==========================================================================
  console.log(`\n✅ TypeScript workflow successfully synced to database!`);
  console.log(`\n📊 Summary:`);
  console.log(`   Workflow ID: ${newWorkflow.id}`);
  console.log(`   Name: ${metadata.name}`);
  console.log(`   Version: 1.0.0`);
  console.log(`   Steps: ${metadata.steps.length}`);
  console.log(`   Files uploaded: ${uploadedCount}`);
  console.log(`\n🔗 View in dashboard: http://localhost:3000/dashboard`);
  console.log(`\n⚠️  Remember: This is LOCAL ONLY. Not pushed to production.`);
}

// Run the test
testTypeScriptWorkflowSync().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
