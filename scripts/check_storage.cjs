require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // Check latest version
  const { data: workflow } = await supabase
    .from('deployed_workflows')
    .select('version, github_folder')
    .eq('id', 71)
    .single();

  console.log('Current workflow version:', workflow?.version);

  // Check versions table
  const { data: versions } = await supabase
    .from('deployed_workflow_versions')
    .select('version_number, created_at, is_active')
    .eq('workflow_id', 71)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('\nLatest versions:');
  versions?.forEach(v => {
    console.log(`  v${v.version_number} - ${v.created_at} - Active: ${v.is_active}`);
  });

  // Get latest active version
  const activeVersion = versions?.find(v => v.is_active);
  const versionToCheck = activeVersion?.version_number || workflow?.version;

  console.log('\nChecking storage for version:', versionToCheck);

  // Download and check the file
  const storagePath = `workflows/71/add_adjustments.js`;
  const { data: fileData, error } = await supabase.storage
    .from('workflow-files')
    .download(storagePath);

  if (error) {
    console.error('Error downloading file:', error.message);
  } else {
    const content = await fileData.text();
    // Check for our timestamp
    if (content.includes('Version: Updated at')) {
      console.log('✅ FILE UPDATED! Contains timestamp log');
      const lines = content.split('\n');
      const timestampLine = lines.find(l => l.includes('Version: Updated at'));
      console.log('Found:', timestampLine);
    } else {
      console.log('❌ File NOT updated - missing timestamp log');
    }

    console.log('\nFile size:', content.length, 'bytes');
    console.log('First 500 chars:\n', content.substring(0, 500));
  }

  // Check workflow_files table
  console.log('\n=== Checking workflow_files table ===');
  const { data: files } = await supabase
    .from('workflow_files')
    .select('file_path, storage_path, file_hash, created_at, version_number')
    .eq('workflow_id', 71)
    .eq('file_path', 'add_adjustments.js')
    .order('created_at', { ascending: false })
    .limit(3);

  if (files && files.length > 0) {
    console.log('Recent file records:');
    files.forEach(f => {
      console.log(`  ${f.file_path} - v${f.version_number} - ${f.created_at}`);
      console.log(`    Storage: ${f.storage_path}`);
      console.log(`    Hash: ${f.file_hash?.substring(0, 8)}...`);
    });
  } else {
    console.log('No file records found in workflow_files table');
  }
})();