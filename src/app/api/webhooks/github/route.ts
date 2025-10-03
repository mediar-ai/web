import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
import { WorkflowFileManager, WorkflowFile } from '@/lib/workflow-file-manager';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { Octokit } from '@octokit/rest';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

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

    // Find changed workflow folders and their filenames
    const changedWorkflows = new Map<string, string>(); // folder -> filename
    const foldersWithJsChanges = new Set<string>(); // folders with only JS changes
    const jsOnlyWorkflows = new Set<string>(); // track which workflows had JS-only changes

    for (const commit of payload.commits) {
      const allFiles = [...(commit.added || []), ...(commit.modified || [])];

      for (const file of allFiles) {
        // Match pattern: onedriveautomation/workflow.yaml or terminator.yml
        const yamlMatch = file.match(/^([^\/]+)\/(workflow\.ya?ml|terminator\.ya?ml)$/);
        if (yamlMatch) {
          const folderName = yamlMatch[1];
          const fileName = yamlMatch[2];
          // Store the actual filename for this folder
          changedWorkflows.set(folderName, fileName);
          // Remove from JS-only set if it was added there
          foldersWithJsChanges.delete(folderName);
        } else {
          // Match .js files in workflow folders
          const jsMatch = file.match(/^([^\/]+)\/(.+\.js)$/);
          if (jsMatch) {
            const folderName = jsMatch[1];
            // Only add to JS-only set if not already in YAML changes
            if (!changedWorkflows.has(folderName)) {
              foldersWithJsChanges.add(folderName);
            }
          }
        }
      }
    }

    // Process JS-only changes - verify workflow exists and add to processing queue
    for (const folderName of foldersWithJsChanges) {
      // Look up workflow by github_folder to verify it exists
      const { data: existing } = await supabase
        .from('deployed_workflows')
        .select('id, github_path')
        .eq('github_folder', folderName)
        .single();

      if (existing && existing.github_path) {
        // Extract the YAML filename from the stored path
        const fileName = existing.github_path.split('/').pop() || 'workflow.yaml';
        changedWorkflows.set(folderName, fileName);
        jsOnlyWorkflows.add(folderName); // Mark as JS-only change
      } else {
        console.log(`ℹ️ Skipping JS changes in ${folderName} - no workflow found in DB`);
      }
    }

    if (changedWorkflows.size === 0) {
      return NextResponse.json({ message: 'No workflow changes' });
    }

    const results = {
      updated: [] as string[],
      created: [] as string[],
      errors: [] as string[]
    };

    for (const [folderName, fileName] of changedWorkflows) {
      try {
        // Get workflow content using the actual filename
        const filePath = `${folderName}/${fileName}`;
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
          .select('id, name, github_sha')
          .eq('github_folder', folderName)
          .single();

        if (existing) {
          // Check if content actually changed by comparing SHA
          // Skip SHA check for JS-only changes (YAML hasn't changed but JS files have)
          const isJsOnly = jsOnlyWorkflows.has(folderName);
          if (!isJsOnly && existing.github_sha === content.metadata.sha) {
            console.log(`ℹ️ No changes detected for ${folderName} (SHA: ${content.metadata.sha})`);
            // Just update sync timestamp without creating a new version
            await supabase
              .from('deployed_workflows')
              .update({
                github_last_synced_at: new Date().toISOString(),
                github_sync_status: 'synced'
              })
              .eq('id', existing.id);

            results.updated.push(`${existing.name} (no changes)`);
            continue;
          }

          if (isJsOnly) {
            console.log(`📦 JS-only changes detected for ${folderName}, creating new version...`);
          }

          // Content changed - create new version entry

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

          // Create new version entry (inactive initially)
          const { data: newVersion, error: versionError } = await supabase
            .from('deployed_workflow_versions')
            .insert({
              workflow_id: existing.id,
              version_number: newVersionNumber,
              automation_sequence_yaml: content.yaml,
              automation_sequence: yaml.load(content.yaml),
              preferred_format: 'yaml',
              is_active: false,  // Start inactive
              change_notes: `Synced from GitHub commit ${content.metadata.sha.substring(0, 7)}`
            })
            .select()
            .single();

          if (versionError) {
            results.errors.push(`${folderName}: Version creation failed - ${versionError.message}`);
            continue;
          }

          // Activate the new version using the RPC function
          const { error: activateError } = await supabase
            .rpc('activate_workflow_version', {
              p_workflow_id: existing.id,
              p_version_number: newVersionNumber
            });

          if (activateError) {
            console.error(`Failed to activate version ${newVersionNumber}: ${activateError.message}`);
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
              // Removed 'version' field - it causes constraint violation
              automation_sequence: yaml.load(content.yaml),
              automation_sequence_yaml: content.yaml,  // Store YAML format as well
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
            // Fetch and upload JS files if any exist
            const { jsFiles, subdirectory } = await fetchWorkflowFiles(folderName, branch);

            if (jsFiles.length > 0) {
              console.log(`📦 Found ${jsFiles.length} JS files in ${folderName}, uploading to storage...`);

              const fileManager = new WorkflowFileManager();
              const uploadResult = await fileManager.uploadWorkflowFiles(
                existing.id,
                newVersionNumber,
                jsFiles,
                subdirectory
              );

              if (uploadResult.success) {
                // Update workflow with files metadata
                await supabase
                  .from('deployed_workflows')
                  .update({
                    requires_files: true,
                    files_config: {
                      file_count: jsFiles.length,
                      total_size: jsFiles.reduce((sum, f) => sum + f.content.length, 0),
                      subdirectory: subdirectory || null,
                      last_updated: new Date().toISOString()
                    }
                  })
                  .eq('id', existing.id);

                console.log(`✅ Uploaded ${jsFiles.length} files to storage for workflow ${existing.id}`);
              } else {
                console.error(`❌ Failed to upload files: ${uploadResult.error}`);
                results.errors.push(`${folderName}: File upload failed - ${uploadResult.error}`);
              }
            }

            results.updated.push(`${workflowName} (v${newVersionNumber})`);
          }
        } else {
          // Workflow doesn't exist - create it
          const { data: newWorkflow, error: createError } = await supabase
            .from('deployed_workflows')
            .insert({
              name: workflowName,
              status: isDevelopment ? 'draft' : 'deployed',
              automation_sequence: yaml.load(content.yaml),
              automation_sequence_yaml: content.yaml,
              github_folder: folderName,
              github_path: filePath,
              github_sha: content.metadata.sha,
              github_ref: branch,
              github_sync_status: 'synced',
              github_last_synced_at: new Date().toISOString(),
              version: '1.0.0',
              total_versions: 1
            })
            .select()
            .single();

          if (createError) {
            results.errors.push(`${folderName}: Create failed - ${createError.message}`);
          } else {
            // Create initial version entry (inactive initially)
            const { data: initialVersion, error: versionError } = await supabase
              .from('deployed_workflow_versions')
              .insert({
                workflow_id: newWorkflow.id,
                version_number: '1.0.0',
                automation_sequence_yaml: content.yaml,
                automation_sequence: yaml.load(content.yaml),
                preferred_format: 'yaml',
                is_active: false,  // Start inactive
                change_notes: `Created from GitHub: ${content.metadata.sha.substring(0, 7)}`
              })
              .select()
              .single();

            if (versionError) {
              results.errors.push(`${folderName}: Version creation failed - ${versionError.message}`);
            } else {
              // Activate the initial version using the RPC function
              const { error: activateError } = await supabase
                .rpc('activate_workflow_version', {
                  p_workflow_id: newWorkflow.id,
                  p_version_number: '1.0.0'
                });

              if (activateError) {
                console.error(`Failed to activate initial version: ${activateError.message}`);
              }

              // Update workflow to point to this version
              await supabase
                .from('deployed_workflows')
                .update({ current_version_id: initialVersion.id })
                .eq('id', newWorkflow.id);

              // Fetch and upload JS files if any exist
              const { jsFiles, subdirectory } = await fetchWorkflowFiles(folderName, branch);

              if (jsFiles.length > 0) {
                console.log(`📦 Found ${jsFiles.length} JS files in ${folderName}, uploading to storage...`);

                const fileManager = new WorkflowFileManager();
                const uploadResult = await fileManager.uploadWorkflowFiles(
                  newWorkflow.id,
                  '1.0.0',
                  jsFiles,
                  subdirectory
                );

                if (uploadResult.success) {
                  // Update workflow with files metadata
                  await supabase
                    .from('deployed_workflows')
                    .update({
                      requires_files: true,
                      files_config: {
                        file_count: jsFiles.length,
                        total_size: jsFiles.reduce((sum, f) => sum + f.content.length, 0),
                        subdirectory: subdirectory || null,
                        last_updated: new Date().toISOString()
                      }
                    })
                    .eq('id', newWorkflow.id);

                  console.log(`✅ Uploaded ${jsFiles.length} files to storage for workflow ${newWorkflow.id}`);
                } else {
                  console.error(`❌ Failed to upload files: ${uploadResult.error}`);
                  results.errors.push(`${folderName}: File upload failed - ${uploadResult.error}`);
                }
              }

              results.created.push(workflowName);
            }
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
      message: `Processed ${changedWorkflows.size} workflows`,
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

/**
 * Fetch all files in a workflow folder from GitHub
 */
async function fetchWorkflowFiles(
  folderName: string,
  branch: string = 'main'
): Promise<{ jsFiles: WorkflowFile[]; subdirectory?: string }> {
  try {
    // Get folder contents from GitHub
    const { data: contents } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: folderName,
      ref: branch
    });

    if (!Array.isArray(contents)) {
      return { jsFiles: [] };
    }

    // Filter for JS files
    const jsFileInfos = contents.filter(
      file => file.type === 'file' && file.name.endsWith('.js')
    );

    if (jsFileInfos.length === 0) {
      return { jsFiles: [] };
    }

    // Fetch content for each JS file
    const jsFiles: WorkflowFile[] = [];
    let detectedSubdir: string | undefined;

    for (const fileInfo of jsFileInfos) {
      const { data: fileData } = await octokit.repos.getContent({
        owner: 'mediar-ai',
        repo: 'workflows',
        path: fileInfo.path,
        ref: branch
      });

      if ('content' in fileData && fileData.content) {
        // Decode base64 content
        const content = Buffer.from(fileData.content, 'base64');

        // Determine file path relative to workflow folder
        // e.g., "testfolder/scripts/script.js" -> "scripts/script.js"
        const relativePath = fileInfo.path.replace(`${folderName}/`, '');

        // Detect subdirectory from first file
        if (!detectedSubdir && relativePath.includes('/')) {
          const firstSlash = relativePath.indexOf('/');
          const potentialSubdir = relativePath.substring(0, firstSlash);

          // Check if all files start with this subdirectory
          const allMatch = jsFileInfos.every(f => {
            const relPath = f.path.replace(`${folderName}/`, '');
            return relPath.startsWith(potentialSubdir + '/');
          });

          if (allMatch) {
            detectedSubdir = potentialSubdir;
          }
        }

        jsFiles.push({
          path: relativePath,
          content
        });
      }
    }

    return { jsFiles, subdirectory: detectedSubdir };
  } catch (error) {
    console.error(`Error fetching files from GitHub folder ${folderName}:`, error);
    return { jsFiles: [] };
  }
}