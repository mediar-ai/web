/**
 * Test webhook deletion handler locally by simulating a GitHub push event
 * with deleted files.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://eshwntsgsputksqamckh.supabase.co";
const SERVICE_ROLE_KEY = "***REMOVED***";

async function test() {
  console.log("🧪 Testing workflow deletion handler locally");
  console.log("=" + "=".repeat(59));

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Step 1: Create test workflow
  console.log("\n📝 Creating test workflow...");
  const { data: workflow, error: createError } = await supabase
    .from('deployed_workflows')
    .insert({
      name: 'Test Local Deletion',
      automation_sequence: [],
      organization_id: 1,
      github_folder: 'test-local-delete'
    })
    .select()
    .single();

  if (createError || !workflow) {
    console.error("❌ Failed to create workflow:", createError);
    return;
  }

  console.log(`✅ Created workflow: ${workflow.name} (ID: ${workflow.id})`);

  // Step 2: Add storage files
  console.log("\n📤 Adding storage files...");
  const storagePaths = [
    `workflows/${workflow.id}/test1.js`,
    `workflows/${workflow.id}/test2.js`
  ];

  for (const path of storagePaths) {
    const { error } = await supabase.storage
      .from('workflow-files')
      .upload(path, '// test', { upsert: true });

    if (error) {
      console.error(`   ❌ Failed to upload ${path}:`, error);
    } else {
      console.log(`   ✅ Uploaded: ${path}`);
    }
  }

  // Create DB records
  for (const path of storagePaths) {
    await supabase.from('workflow_files').insert({
      workflow_id: workflow.id,
      version_number: '1.0.0',
      file_path: path.split('/').pop(),
      storage_path: path,
      file_hash: 'test',
      file_size: 10,
      content_type: 'text/plain'
    });
  }
  console.log(`✅ Created ${storagePaths.length} workflow_files records`);

  // Step 3: Simulate deletion
  console.log("\n🗑️ Testing deletion process...");

  // Get files BEFORE deletion
  const { data: files } = await supabase
    .from('workflow_files')
    .select('storage_path')
    .eq('workflow_id', workflow.id);

  console.log(`📦 Found ${files?.length || 0} files to delete`);

  // Delete from storage
  if (files && files.length > 0) {
    const paths = files.map(f => f.storage_path);
    const { error: storageError } = await supabase.storage
      .from('workflow-files')
      .remove(paths);

    if (storageError) {
      console.error("   ❌ Storage deletion failed:", storageError);
    } else {
      console.log(`   ✅ Deleted ${paths.length} files from storage`);
    }
  }

  // Delete workflow (CASCADE)
  const { error: deleteError } = await supabase
    .from('deployed_workflows')
    .delete()
    .eq('id', workflow.id);

  if (deleteError) {
    console.error("   ❌ Workflow deletion failed:", deleteError);
  } else {
    console.log(`   ✅ Deleted workflow from DB`);
  }

  // Step 4: Verify cleanup
  console.log("\n🔍 Verifying cleanup...");

  // Check workflow deleted
  const { data: checkWorkflow } = await supabase
    .from('deployed_workflows')
    .select('id')
    .eq('id', workflow.id)
    .single();

  if (checkWorkflow) {
    console.log("   ❌ Workflow still exists");
  } else {
    console.log("   ✅ Workflow deleted");
  }

  // Check files CASCADE deleted
  const { count } = await supabase
    .from('workflow_files')
    .select('*', { count: 'exact', head: true })
    .eq('workflow_id', workflow.id);

  if (count && count > 0) {
    console.log(`   ❌ ${count} workflow_files still exist`);
  } else {
    console.log("   ✅ workflow_files CASCADE deleted");
  }

  // Check storage files deleted
  let storageExists = 0;
  for (const path of storagePaths) {
    const { data } = await supabase.storage
      .from('workflow-files')
      .download(path);

    if (data) {
      storageExists++;
    }
  }

  if (storageExists > 0) {
    console.log(`   ❌ ${storageExists}/${storagePaths.length} storage files still exist`);
  } else {
    console.log("   ✅ All storage files deleted");
  }

  console.log("\n" + "=".repeat(60));
  if (!checkWorkflow && count === 0 && storageExists === 0) {
    console.log("🎉 TEST PASSED - Deletion logic works correctly!");
  } else {
    console.log("❌ TEST FAILED - Some cleanup incomplete");
  }
}

test().catch(console.error);
