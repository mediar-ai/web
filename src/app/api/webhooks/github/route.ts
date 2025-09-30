import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
import crypto from 'crypto';
import yaml from 'js-yaml';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GitHub Webhook - Folder name maps to workflow ID via github_folder column
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get('x-hub-signature-256');
    const body = await request.text();

    if (!verifyWebhookSignature(body, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(body);

    // Only process pushes to main or dev
    if (payload.ref !== 'refs/heads/main' && payload.ref !== 'refs/heads/dev') {
      return NextResponse.json({ message: 'Ignored non-main/dev branch' });
    }

    const branch = payload.ref.split('/').pop();
    const isDevelopment = branch === 'dev';

    // Find changed workflow folders
    const changedFolders = new Set<string>();

    for (const commit of payload.commits) {
      const allFiles = [...(commit.added || []), ...(commit.modified || [])];

      for (const file of allFiles) {
        // Match pattern: onedriveautomation/workflow.yaml
        const match = file.match(/^([^\/]+)\/(workflow\.ya?ml|terminator\.ya?ml)$/);
        if (match) {
          changedFolders.add(match[1]);
        }
      }
    }

    if (changedFolders.size === 0) {
      return NextResponse.json({ message: 'No workflow changes' });
    }

    const results = {
      updated: [] as string[],
      created: [] as string[],
      errors: [] as string[]
    };

    for (const folderName of changedFolders) {
      try {
        // Get workflow content
        const filePath = `${folderName}/workflow.yaml`;
        const content = await githubWorkflowManager.getWorkflow(filePath, branch);

        if (!content) {
          results.errors.push(`${folderName}: Could not read workflow file`);
          continue;
        }

        // Parse to extract workflow name
        let workflowName = folderName;
        try {
          const parsed = yaml.load(content.yaml) as any;
          if (parsed.name) {
            workflowName = parsed.name;
          } else if (Array.isArray(parsed) && parsed[0]?.name) {
            workflowName = parsed[0].name;
          }
        } catch (e) {
          console.log(`Using folder name as workflow name for ${folderName}`);
        }

        // Look up workflow by github_folder
        const { data: existing } = await supabase
          .from('deployed_workflows')
          .select('id, name')
          .eq('github_folder', folderName)
          .single();

        if (existing) {
          // Update existing workflow - create new version entry

          // Get current version to increment
          const { data: latestVersion } = await supabase
            .from('deployed_workflow_versions')
            .select('version_number')
            .eq('workflow_id', existing.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          // Increment patch version (e.g., 1.0.0 -> 1.0.1)
          let newVersionNumber = '1.0.0';
          if (latestVersion?.version_number) {
            const parts = latestVersion.version_number.split('.');
            const patch = parseInt(parts[2] || '0') + 1;
            newVersionNumber = `${parts[0]}.${parts[1]}.${patch}`;
          }

          // Create new version entry
          const { data: newVersion, error: versionError } = await supabase
            .from('deployed_workflow_versions')
            .insert({
              workflow_id: existing.id,
              version_number: newVersionNumber,
              automation_sequence_yaml: content.yaml,
              automation_sequence: yaml.load(content.yaml),
              preferred_format: 'yaml',
              is_active: true,
              change_notes: `Synced from GitHub commit ${content.metadata.sha.substring(0, 7)}`
            })
            .select()
            .single();

          if (versionError) {
            results.errors.push(`${folderName}: Version creation failed - ${versionError.message}`);
            continue;
          }

          // Get current total_versions to increment
          const { data: currentWorkflow } = await supabase
            .from('deployed_workflows')
            .select('total_versions')
            .eq('id', existing.id)
            .single();

          // Update workflow to point to new version
          const { error } = await supabase
            .from('deployed_workflows')
            .update({
              name: workflowName,
              automation_sequence: yaml.load(content.yaml),
              current_version_id: newVersion.id,
              total_versions: (currentWorkflow?.total_versions || 0) + 1,
              github_path: filePath,
              github_sha: content.metadata.sha,
              github_ref: branch,
              github_sync_status: 'synced',
              github_last_synced_at: new Date().toISOString(),
              status: isDevelopment ? 'draft' : 'deployed'
            })
            .eq('id', existing.id);

          if (error) {
            results.errors.push(`${folderName}: Update failed - ${error.message}`);
          } else {
            results.updated.push(`${workflowName} (v${newVersionNumber})`);
          }
        } else {
          // Workflow doesn't exist - create it
          const { error: createError } = await supabase
            .from('deployed_workflows')
            .insert({
              name: workflowName,
              status: isDevelopment ? 'draft' : 'deployed',
              automation_sequence: yaml.load(content.yaml),
              github_folder: folderName,
              github_path: filePath,
              github_sha: content.metadata.sha,
              github_ref: branch,
              github_sync_status: 'synced',
              github_last_synced_at: new Date().toISOString(),
              version: '1.0.0'
            })
            .select()
            .single();

          if (createError) {
            results.errors.push(`${folderName}: Create failed - ${createError.message}`);
          } else {
            results.created.push(workflowName);
          }
        }

        // Log sync operation
        await supabase
          .from('github_workflow_sync_log')
          .insert({
            workflow_id: existing?.id,
            operation: 'webhook_sync',
            github_path: filePath,
            github_sha: content.metadata.sha,
            status: 'success'
          });

      } catch (error) {
        console.error(`Error processing ${folderName}:`, error);
        results.errors.push(`${folderName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return NextResponse.json({
      success: results.errors.length === 0,
      message: `Processed ${changedFolders.size} workflows`,
      branch,
      results
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

function verifyWebhookSignature(body: string, signature: string | null): boolean {
  if (!signature || !process.env.GITHUB_WEBHOOK_SECRET) {
    console.warn('No webhook signature or secret configured');
    return false;
  }

  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(body).digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );
}