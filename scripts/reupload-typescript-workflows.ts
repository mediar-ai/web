#!/usr/bin/env tsx
/**
 * Re-upload TypeScript Workflow Files with Org-Based Paths
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { WorkflowFileManager } from '../src/lib/workflow-file-manager';
import { promises as fs } from 'fs';
import path from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TypeScriptWorkflow {
  id: number;
  name: string;
  github_folder: string;
  current_version_number: string;
}

async function collectWorkflowFiles(workflowPath: string): Promise<Array<{ path: string; content: Buffer }>> {
  const files: Array<{ path: string; content: Buffer }> = [];

  async function walk(dir: string, baseDir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) {
          await walk(fullPath, baseDir);
        } else if (entry.isFile() && /\.(ts|js|json)$/.test(entry.name)) {
          const content = await fs.readFile(fullPath);
          const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
          files.push({ path: relativePath, content });
        }
      }
    } catch (error) {
      console.warn(`   Warning: Could not read directory ${dir}`);
    }
  }

  await walk(workflowPath, workflowPath);
  return files;
}

async function reuploadWorkflow(workflow: TypeScriptWorkflow, dryRun: boolean): Promise<number> {
  console.log(`\n📦 Workflow #${workflow.id}: ${workflow.name}`);

  const possiblePaths = [
    `../../workflows/${workflow.github_folder}`
  ];

  let workflowPath: string | null = null;
  for (const testPath of possiblePaths) {
    try {
      await fs.access(testPath);
      workflowPath = testPath;
      break;
    } catch {}
  }

  if (!workflowPath) {
    console.log(`   ⚠️  Workflow directory not found locally - skipping`);
    return 0;
  }

  const files = await collectWorkflowFiles(workflowPath);
  if (files.length === 0) {
    console.log(`   ⚠️  No files found`);
    return 0;
  }

  console.log(`   Found ${files.length} file(s)`);

  if (dryRun) {
    console.log(`   [DRY RUN] Would upload ${files.length} files`);
    return files.length;
  }

  const fileManager = new WorkflowFileManager();
  let uploadedCount = 0;

  for (const file of files) {
    const result = await fileManager.uploadWorkflowFiles(workflow.id, workflow.current_version_number, [file], undefined);
    if (result.success) {
      uploadedCount++;
      console.log(`     ✓ ${file.path}`);
    } else {
      console.error(`     ✗ ${file.path}: ${result.error}`);
    }
  }

  console.log(`   ✅ Uploaded ${uploadedCount}/${files.length} files`);
  return uploadedCount;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log('🚀 Re-upload TypeScript Workflows with Org-Based Paths\n');
  if (dryRun) console.log('🔍 DRY RUN MODE\n');

  const { data: workflows, error } = await supabase
    .from('deployed_workflows')
    .select(`id, name, github_folder, deployed_workflow_versions!deployed_workflows_current_version_id_fkey(version_number)`)
    .eq('preferred_format', 'typescript')
    .not('organization_id', 'is', null);

  if (error || !workflows || workflows.length === 0) {
    console.log('⚠️  No TypeScript workflows found');
    process.exit(0);
  }

  console.log(`Found ${workflows.length} TypeScript workflow(s)\n`);

  let totalFilesUploaded = 0;
  for (const wf of workflows) {
    const workflow: TypeScriptWorkflow = {
      id: wf.id,
      name: wf.name,
      github_folder: wf.github_folder,
      current_version_number: (wf as any).deployed_workflow_versions?.version_number || '1.0.0'
    };
    try {
      totalFilesUploaded += await reuploadWorkflow(workflow, dryRun);
    } catch (err) {
      console.error(`❌ Failed workflow #${workflow.id}:`, err);
    }
  }

  console.log(`\n📊 Total files uploaded: ${totalFilesUploaded}`);
  if (!dryRun) {
    console.log('\n✅ Complete! Files now use org-based paths: org-{clerk_org_id}/workflows/{id}/');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
