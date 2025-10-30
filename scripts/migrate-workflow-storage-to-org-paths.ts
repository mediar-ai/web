#!/usr/bin/env tsx
/**
 * Storage Migration Script: Copy workflows to org-based paths
 *
 * Copies workflow files from:
 *   workflows/{workflow_id}/*
 * To:
 *   org-{organization_id}/workflows/{workflow_id}/*
 *
 * IMPORTANT: This script COPIES files (does not delete originals)
 * to maintain backward compatibility with existing prod VMs.
 *
 * Run after deployment: npm run migrate-workflow-storage
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!SUPABASE_URL);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!SUPABASE_SERVICE_KEY);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface Workflow {
  id: number;
  name: string;
  organization_id: string;
  github_folder?: string;
}

async function listFilesInPath(bucket: string, path: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from(bucket).list(path, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' }
  });

  if (error) {
    console.error(`Error listing files in ${path}:`, error);
    return [];
  }

  return data?.map(file => file.name) || [];
}

async function copyFile(bucket: string, fromPath: string, toPath: string): Promise<boolean> {
  try {
    // Download file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from(bucket)
      .download(fromPath);

    if (downloadError) {
      console.error(`  ❌ Failed to download ${fromPath}:`, downloadError.message);
      return false;
    }

    // Upload to new location
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(toPath, fileData, {
        contentType: fileData.type,
        upsert: true, // Overwrite if exists (idempotent)
      });

    if (uploadError) {
      console.error(`  ❌ Failed to upload ${toPath}:`, uploadError.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error(`  ❌ Error copying ${fromPath} to ${toPath}:`, err);
    return false;
  }
}

async function migrateWorkflowFiles(workflow: Workflow, dryRun: boolean = false): Promise<number> {
  const workflowId = workflow.id;
  const orgId = workflow.organization_id;

  // Old path: workflows/{workflow_id}/
  // New path: org-{org_id}/workflows/{workflow_id}/
  const oldPrefix = `workflows/${workflowId}`;
  const newPrefix = `org-${orgId}/workflows/${workflowId}`;

  console.log(`\n📦 Workflow #${workflowId}: ${workflow.name}`);
  console.log(`   Org: ${orgId}`);
  console.log(`   Old path: ${oldPrefix}/`);
  console.log(`   New path: ${newPrefix}/`);

  // List all files in old path
  const files = await listFilesInPath('workflow-files', oldPrefix);

  if (files.length === 0) {
    console.log('   ⚠️  No files found in old path (may already be migrated or empty)');
    return 0;
  }

  console.log(`   Found ${files.length} file(s) to copy`);

  let copiedCount = 0;
  for (const fileName of files) {
    const oldPath = `${oldPrefix}/${fileName}`;
    const newPath = `${newPrefix}/${fileName}`;

    if (dryRun) {
      console.log(`   [DRY RUN] Would copy: ${oldPath} → ${newPath}`);
      copiedCount++;
    } else {
      const success = await copyFile('workflow-files', oldPath, newPath);
      if (success) {
        console.log(`   ✅ Copied: ${fileName}`);
        copiedCount++;
      }
    }
  }

  return copiedCount;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const workflowIdFilter = args.find(arg => arg.startsWith('--workflow-id='))?.split('=')[1];

  console.log('🚀 Workflow Storage Migration to Org-Based Paths\n');
  console.log('================================================\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be copied\n');
  }

  // Fetch all workflows with organization IDs
  let query = supabase
    .from('deployed_workflows')
    .select('id, name, organization_id, github_folder')
    .not('organization_id', 'is', null);

  if (workflowIdFilter) {
    query = query.eq('id', parseInt(workflowIdFilter));
    console.log(`🎯 Filtering to workflow ID: ${workflowIdFilter}\n`);
  }

  const { data: workflows, error } = await query;

  if (error) {
    console.error('❌ Failed to fetch workflows:', error);
    process.exit(1);
  }

  if (!workflows || workflows.length === 0) {
    console.log('⚠️  No workflows found to migrate');
    process.exit(0);
  }

  console.log(`Found ${workflows.length} workflow(s) to migrate\n`);

  let totalFilesCopied = 0;
  let totalWorkflowsProcessed = 0;
  const failedWorkflows: number[] = [];

  for (const workflow of workflows) {
    try {
      const filesCopied = await migrateWorkflowFiles(workflow, dryRun);
      totalFilesCopied += filesCopied;
      totalWorkflowsProcessed++;
    } catch (err) {
      console.error(`❌ Failed to migrate workflow #${workflow.id}:`, err);
      failedWorkflows.push(workflow.id);
    }
  }

  // Summary
  console.log('\n================================================');
  console.log('📊 MIGRATION SUMMARY\n');
  console.log(`   Workflows processed: ${totalWorkflowsProcessed}/${workflows.length}`);
  console.log(`   Files copied: ${totalFilesCopied}`);

  if (failedWorkflows.length > 0) {
    console.log(`\n   ⚠️  Failed workflows (${failedWorkflows.length}): ${failedWorkflows.join(', ')}`);
  }

  if (dryRun) {
    console.log('\n💡 Run without --dry-run to perform the actual migration');
  } else {
    console.log('\n✅ Migration complete!');
    console.log('\n📝 NOTE: Original files in workflows/{id}/ are preserved for backward compatibility.');
    console.log('   Delete them only after confirming all VMs are using org-based paths.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
