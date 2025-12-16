import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { githubWorkflowManager } from '@/lib/github-workflow-manager';
import { WorkflowFileManager, WorkflowFile } from '@/lib/workflow-file-manager';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import crypto from 'crypto';
import yaml from 'js-yaml';
import { Octokit } from '@octokit/rest';
import { Buffer } from 'buffer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
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

    // CRITICAL: Ignore pushes made by our own API to prevent circular version creation
    // When the UI creates a version, it pushes to GitHub. We don't want the webhook
    // to then create another version, which would push again, triggering another webhook...
    const pusher = payload.pusher?.name || payload.pusher?.email || '';
    const headCommit = payload.head_commit;
    const commitAuthor =
      headCommit?.author?.username || headCommit?.author?.email || '';

    // Check if this push was made by the Mediar automation system
    const isAutomatedPush =
      pusher.includes('mediar') ||
      pusher.includes('workflow-manager') ||
      commitAuthor.includes('mediar') ||
      commitAuthor.includes('workflow-manager') ||
      (headCommit?.message &&
        (headCommit.message.includes('Update workflow:') ||
          headCommit.message.includes('Add/Update workflow:') ||
          headCommit.message.includes('Update default values:'))); // Ignore save-defaults pushes

    if (isAutomatedPush) {
      console.log(
        '🤖 Ignoring automated push from Mediar system to prevent circular version creation'
      );
      console.log('   Pusher:', pusher);
      console.log('   Author:', commitAuthor);
      console.log('   Message:', headCommit?.message?.substring(0, 50));
      return NextResponse.json({
        message: 'Ignored automated push (prevents duplicate versions)',
        pusher,
        commitAuthor,
      });
    }

    // Find changed workflow folders and their filenames
    const changedWorkflows = new Map<string, string>(); // folder -> filename
    const workflowOrgPrefixes = new Map<string, string | undefined>(); // folder -> orgPrefix
    const foldersWithJsChanges = new Set<string>(); // folders with only JS changes
    const jsOnlyWorkflows = new Set<string>(); // track which workflows had JS-only changes
    const changedJsFiles = new Map<string, string[]>(); // folder -> list of changed JS files
    const deletedWorkflows = new Set<string>(); // folders with deleted workflows

    for (const commit of payload.commits) {
      const allFiles = [...(commit.added || []), ...(commit.modified || [])];
      const removedFiles = commit.removed || [];

      // Process removed files first to detect workflow deletions
      for (const file of removedFiles) {
        const yamlMatch = file.match(
          /^(org-([^\/]+)\/)?([^\/]+)\/(workflow\.ya?ml|terminator\.ya?ml)$/
        );
        const tsMatch = file.match(
          /^(org-([^\/]+)\/)?([^\/]+)\/src\/terminator\.ts$/
        );

        if (yamlMatch) {
          const _orgPrefix = yamlMatch[2]; // Reserved for future multi-org folder structure
          const folderName = yamlMatch[3];
          const removedFileName = yamlMatch[4];
          console.log(
            `🗑️ Detected YAML file removal: ${folderName}/${removedFileName}`
          );

          // SMART DELETION: Check if OTHER YAML files still exist in the folder
          const otherYamlsExist = await checkGitHubFolderForYamls(
            folderName,
            branch
          );

          if (!otherYamlsExist) {
            deletedWorkflows.add(folderName);
            console.log(
              `   ✓ Marking ${folderName} for deletion - no YAML files remain`
            );
          } else {
            console.log(
              `   ℹ️ NOT deleting ${folderName} - other YAML files still exist`
            );
          }
        } else if (tsMatch) {
          const _orgPrefix = tsMatch[2];
          const folderName = tsMatch[3];
          console.log(
            `🗑️ Detected TypeScript workflow removal: ${folderName}/src/terminator.ts`
          );

          // For TypeScript workflows, if src/terminator.ts is deleted, delete the workflow
          deletedWorkflows.add(folderName);
          console.log(
            `   ✓ Marking ${folderName} for deletion - TypeScript workflow removed`
          );
        }
      }

      for (const file of allFiles) {
        // Match pattern: onedriveautomation/workflow.yaml or terminator.yml OR src/terminator.ts (TypeScript)
        const yamlMatch = file.match(
          /^(org-([^\/]+)\/)?([^\/]+)\/(workflow\.ya?ml|terminator\.ya?ml)$/
        );
        const tsMatch = file.match(
          /^(org-([^\/]+)\/)?([^\/]+)\/src\/terminator\.ts$/
        );

        if (yamlMatch) {
          // Stored in Map, retrieved later at line 253, used at line 496
          const orgPrefix = yamlMatch[2];
          const folderName = yamlMatch[3];
          const fileName = yamlMatch[4];
          // Store the actual filename and org prefix for this folder
          changedWorkflows.set(folderName, fileName);
          workflowOrgPrefixes.set(folderName, orgPrefix);
          // Remove from JS-only set if it was added there
          foldersWithJsChanges.delete(folderName);
        } else if (tsMatch) {
          // TypeScript workflow detected
          const orgPrefix = tsMatch[2];
          const folderName = tsMatch[3];
          const fileName = 'src/terminator.ts';
          // Store TypeScript workflow
          changedWorkflows.set(folderName, fileName);
          workflowOrgPrefixes.set(folderName, orgPrefix);
          // Remove from JS-only set if it was added there
          foldersWithJsChanges.delete(folderName);
        } else {
          // Match .js files in workflow folders
          const jsMatch = file.match(/^(org-([^\/]+)\/)?([^\/]+)\/(.+\.js)$/);
          if (jsMatch) {
            const _orgPrefix = jsMatch[2]; // Reserved for future multi-org support
            const folderName = jsMatch[3];
            // const jsFileName = jsMatch[2]; // Not used currently but available if needed

            // Track specific JS files that changed
            if (!changedJsFiles.has(folderName)) {
              changedJsFiles.set(folderName, []);
            }
            changedJsFiles.get(folderName)!.push(file); // Store full path

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
        const fileName =
          existing.github_path.split('/').pop() || 'workflow.yaml';
        changedWorkflows.set(folderName, fileName);
        jsOnlyWorkflows.add(folderName); // Mark as JS-only change
      } else {
        console.log(
          `ℹ️ Skipping JS changes in ${folderName} - no workflow found in DB`
        );
      }
    }

    const results = {
      updated: [] as string[],
      created: [] as string[],
      deleted: [] as string[],
      errors: [] as string[],
    };

    // Process workflow deletions first
    for (const folderName of deletedWorkflows) {
      try {
        console.log(`🔍 Looking up workflow for deletion: ${folderName}`);

        // Find workflow by github_folder
        const { data: workflow } = await supabase
          .from('deployed_workflows')
          .select('id, name')
          .eq('github_folder', folderName)
          .single();

        if (!workflow) {
          console.log(
            `ℹ️ Workflow ${folderName} not found in database - already deleted or never existed`
          );
          continue;
        }

        console.log(
          `🗑️ Archiving workflow ${workflow.name} (ID: ${workflow.id}) from folder ${folderName}`
        );

        // Step 1: Get all storage file paths BEFORE archiving
        const { data: files } = await supabase
          .from('workflow_files')
          .select('storage_path')
          .eq('workflow_id', workflow.id);

        // Step 2: Delete files from storage (files are archived in DB but removed from storage)
        if (files && files.length > 0) {
          console.log(
            `📦 Deleting ${files.length} storage files for workflow ${workflow.id}`
          );
          const storagePaths = files.map(f => f.storage_path);

          const { error: storageError } = await supabase.storage
            .from('workflow-files')
            .remove(storagePaths);

          if (storageError) {
            console.error(
              `⚠️ Warning: Failed to delete some storage files: ${storageError.message}`
            );
            // Continue anyway - don't block archival
          } else {
            console.log(`✅ Deleted ${storagePaths.length} files from storage`);
          }
        }

        // Step 3: Archive workflow using database function
        // This will:
        // - Move workflow to deleted_workflows
        // - Move versions to deleted_workflow_versions
        // - Move files to deleted_workflow_files
        // - Set workflow_id = NULL in workflow_executions (preserve history)
        // - Delete workflow from deployed_workflows (CASCADE cleans up other tables)
        const { data: archiveResult, error: archiveError } = await supabase.rpc(
          'archive_workflow',
          {
            p_workflow_id: workflow.id,
            p_archived_by: `github_webhook:${payload.pusher?.name || 'unknown'}`,
            p_deletion_reason: `GitHub folder deleted from ${branch} branch`,
          }
        );

        if (archiveError) {
          results.errors.push(
            `${folderName}: Failed to archive - ${archiveError.message}`
          );
          console.error(
            `❌ Failed to archive workflow ${workflow.id}: ${archiveError.message}`
          );
        } else {
          results.deleted.push(`${workflow.name} (${folderName})`);
          console.log(
            `✅ Successfully archived workflow ${workflow.name} (ID: ${workflow.id})`
          );
          console.log(`   Archive summary: ${JSON.stringify(archiveResult)}`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`${folderName}: Deletion failed - ${errorMessage}`);
        console.error(`❌ Error deleting workflow ${folderName}:`, error);
      }
    }

    if (changedWorkflows.size === 0 && deletedWorkflows.size === 0) {
      return NextResponse.json({ message: 'No workflow changes' });
    }

    if (changedWorkflows.size === 0) {
      // Only deletions, return early
      return NextResponse.json({
        message: 'Workflow deletions processed',
        results,
      });
    }

    for (const [folderName, fileName] of changedWorkflows) {
      try {
        // Get workflow content using the actual filename
        const orgPrefix = workflowOrgPrefixes.get(folderName);
        const orgPrefixPath = orgPrefix ? `org-${orgPrefix}/` : '';
        const filePath = `${orgPrefixPath}${folderName}/${fileName}`;
        const isTypeScript = fileName.endsWith('.ts');

        console.log(
          `📂 Processing folder: ${folderName}, file: ${fileName} (${isTypeScript ? 'TypeScript' : 'YAML'})`
        );

        // TypeScript workflows: Parse immediately instead of pending
        if (isTypeScript) {
          console.log(
            `🔧 Parsing TypeScript workflow ${folderName} immediately...`
          );

          // Look up existing workflow
          const { data: existing } = await supabase
            .from('deployed_workflows')
            .select('id, name')
            .eq('github_folder', folderName)
            .single();

          let workflowId = existing?.id;
          let workflowName = folderName
            .replace(/_typescript$/, '')
            .replace(/_/g, ' ');

          if (!existing) {
            // Create new workflow for TypeScript
            const { data: newWorkflow, error: createError } = await supabase
              .from('deployed_workflows')
              .insert({
                name: workflowName,
                status: isDevelopment ? 'draft' : 'deployed',
                github_folder: folderName,
                github_path: filePath,
                github_ref: branch,
                github_sync_status: 'pending',
                github_last_synced_at: new Date().toISOString(),
                preferred_format: 'typescript',
                automation_sequence: {}, // Empty object for TypeScript workflows
                organization_id: orgPrefix || MEDIAR_ORG_IDS[0],
                created_by: 'user_REDACTED', // Louis's Clerk ID - GitHub-synced workflows
              })
              .select()
              .single();

            if (createError) {
              results.errors.push(
                `${folderName}: Failed to create TypeScript workflow - ${createError.message}`
              );
              continue;
            }
            workflowId = newWorkflow.id;
          } else {
            workflowName = existing.name;
            // Update to parsing status
            await supabase
              .from('deployed_workflows')
              .update({
                github_last_synced_at: new Date().toISOString(),
                github_sync_status: 'pending',
                github_path: filePath,
              })
              .eq('id', workflowId);
          }

          // Parse TypeScript workflow from GitHub
          try {
            const { parseTypeScriptWorkflow } = await import(
              '@/lib/typescript-workflow-parser'
            );

            // Download terminator.ts from GitHub
            const terminatorPath = `${orgPrefixPath}${folderName}/src/terminator.ts`;
            const { data: terminatorContent } = await octokit.repos.getContent({
              owner: 'mediar-ai',
              repo: 'workflows',
              path: terminatorPath,
              ref: branch,
            });

            if (!terminatorContent || !('content' in terminatorContent)) {
              throw new Error('Could not fetch terminator.ts from GitHub');
            }

            const sourceCode = Buffer.from(
              terminatorContent.content,
              'base64'
            ).toString('utf-8');

            // Parse the TypeScript workflow
            const metadata = parseTypeScriptWorkflow(sourceCode);

            // Create or update version
            const { data: latestVersion } = await supabase
              .from('deployed_workflow_versions')
              .select('version_number')
              .eq('workflow_id', workflowId)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            // Increment patch version (e.g., 1.0.0 -> 1.0.1)
            let newVersionNumber = metadata.version || '1.0.0';
            if (latestVersion?.version_number) {
              const parts = latestVersion.version_number.split('.');
              const patch = parseInt(parts[2] || '0') + 1;
              newVersionNumber = `${parts[0]}.${parts[1]}.${patch}`;
            }

            // Create new version entry
            console.log(
              `📝 Creating TypeScript version ${newVersionNumber} for workflow ${workflowId}...`
            );
            const { data: newVersion, error: versionError } = await supabase
              .from('deployed_workflow_versions')
              .insert({
                workflow_id: workflowId,
                version_number: newVersionNumber,
                automation_sequence: metadata,
                automation_sequence_yaml: null,
                preferred_format: 'typescript',
                typescript_metadata: metadata,
                is_active: false,
                change_notes: `Synced from GitHub (TypeScript)`,
              })
              .select()
              .single();

            if (versionError) {
              console.error(
                `❌ Version creation failed: ${versionError.message}`
              );
              throw new Error(
                `Version creation failed: ${versionError.message}`
              );
            }

            // Activate the new version
            console.log(
              `🔄 Activating TypeScript version ${newVersionNumber}...`
            );
            const { error: activateError } = await supabase.rpc(
              'activate_workflow_version',
              {
                p_workflow_id: workflowId,
                p_version_number: newVersionNumber,
              }
            );

            if (activateError) {
              console.error(
                `❌ Failed to activate version: ${activateError.message}`
              );
            }

            // Upload TypeScript workflow files to S3
            console.log(`📦 Fetching TypeScript workflow files from GitHub...`);
            const tsFiles = await fetchTypeScriptWorkflowFiles(
              `${orgPrefixPath}${folderName}`,
              branch
            );

            if (tsFiles.length > 0) {
              console.log(
                `📤 Uploading ${tsFiles.length} TypeScript files to storage...`
              );

              const fileManager = new WorkflowFileManager();
              let uploadedCount = 0;
              let totalSize = 0;

              for (const file of tsFiles) {
                const result = await fileManager.uploadWorkflowFiles(
                  workflowId,
                  newVersionNumber,
                  [file],
                  undefined
                );

                if (result.success) {
                  uploadedCount++;
                  totalSize += file.content.length;
                  console.log(`  ✓ ${file.path}`);
                } else {
                  console.error(`  ✗ ${file.path}: ${result.error}`);
                }
              }

              console.log(
                `✅ Uploaded ${uploadedCount}/${tsFiles.length} TypeScript files`
              );

              // Update workflow with file metadata
              await supabase
                .from('deployed_workflows')
                .update({
                  typescript_metadata: metadata,
                  github_sync_status: 'synced',
                  name: metadata.name || workflowName,
                  description: metadata.description,
                  current_version_id: newVersion.id,
                  requires_files: uploadedCount > 0,
                  files_config: {
                    file_count: uploadedCount,
                    total_size: totalSize,
                    last_updated: new Date().toISOString(),
                  },
                })
                .eq('id', workflowId);
            } else {
              // No files to upload, just update metadata
              await supabase
                .from('deployed_workflows')
                .update({
                  typescript_metadata: metadata,
                  github_sync_status: 'synced',
                  name: metadata.name || workflowName,
                  description: metadata.description,
                  current_version_id: newVersion.id,
                })
                .eq('id', workflowId);
            }

            console.log(`✅ Parsed TypeScript workflow: ${metadata.name}`);

            if (existing) {
              results.updated.push(`${metadata.name} (TypeScript)`);
            } else {
              results.created.push(`${metadata.name} (TypeScript)`);
            }
          } catch (parseError) {
            console.error(
              `❌ Failed to parse TypeScript workflow ${folderName}:`,
              parseError
            );
            // Update status to failed
            await supabase
              .from('deployed_workflows')
              .update({
                github_sync_status: 'failed',
              })
              .eq('id', workflowId);

            results.errors.push(
              `${folderName}: Failed to parse TypeScript - ${parseError instanceof Error ? parseError.message : String(parseError)}`
            );
          }
          continue;
        }
        const content = await githubWorkflowManager.getWorkflow(
          filePath,
          branch
        );

        if (!content) {
          console.error(`❌ Could not read workflow file: ${filePath}`);
          results.errors.push(`${folderName}: Could not read workflow file`);
          continue;
        }
        console.log(
          `✅ Loaded workflow content (${content.yaml.length} bytes), SHA: ${content.metadata.sha}`
        );

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
        console.log(`🔍 Looking up workflow by github_folder: ${folderName}`);
        const { data: existing } = await supabase
          .from('deployed_workflows')
          .select('id, name, github_sha')
          .eq('github_folder', folderName)
          .single();

        if (existing) {
          console.log(
            `✅ Found existing workflow: ID ${existing.id}, name "${existing.name}"`
          );
          // Check if content actually changed by comparing SHA
          // Skip SHA check for JS-only changes (YAML hasn't changed but JS files have)
          const isJsOnly = jsOnlyWorkflows.has(folderName);
          if (!isJsOnly && existing.github_sha === content.metadata.sha) {
            console.log(
              `ℹ️ No changes detected for ${folderName} (SHA: ${content.metadata.sha})`
            );
            // Just update sync timestamp without creating a new version
            await supabase
              .from('deployed_workflows')
              .update({
                github_last_synced_at: new Date().toISOString(),
                github_sync_status: 'synced',
              })
              .eq('id', existing.id);

            results.updated.push(`${existing.name} (no changes)`);
            continue;
          }

          if (isJsOnly) {
            console.log(
              `📦 JS-only changes detected for ${folderName}, creating new version...`
            );
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
          console.log(
            `📝 Creating new version ${newVersionNumber} for workflow ${existing.id}...`
          );
          const { data: newVersion, error: versionError } = await supabase
            .from('deployed_workflow_versions')
            .insert({
              workflow_id: existing.id,
              version_number: newVersionNumber,
              automation_sequence_yaml: content.yaml,
              automation_sequence: yaml.load(content.yaml),
              preferred_format: 'yaml',
              is_active: false, // Start inactive
              change_notes: `Synced from GitHub commit ${content.metadata.sha.substring(0, 7)}`,
            })
            .select()
            .single();

          if (versionError) {
            console.error(
              `❌ Version creation failed for ${folderName}: ${versionError.message}`
            );
            results.errors.push(
              `${folderName}: Version creation failed - ${versionError.message}`
            );
            continue;
          }
          console.log(
            `✅ Created version ${newVersionNumber} (ID: ${newVersion.id})`
          );

          // Activate the new version using the RPC function
          console.log(`🔄 Activating version ${newVersionNumber}...`);
          const { error: activateError } = await supabase.rpc(
            'activate_workflow_version',
            {
              p_workflow_id: existing.id,
              p_version_number: newVersionNumber,
            }
          );

          if (activateError) {
            console.error(
              `❌ Failed to activate version ${newVersionNumber}: ${activateError.message}`
            );
          } else {
            console.log(`✅ Activated version ${newVersionNumber}`);
          }

          // Get current total_versions to increment
          const { data: currentWorkflow } = await supabase
            .from('deployed_workflows')
            .select('total_versions')
            .eq('id', existing.id)
            .single();

          // Update workflow to point to new version
          // NOTE: Don't overwrite 'name' for existing workflows - preserve human-readable names
          // The name should only be set when creating NEW workflows from GitHub
          const { error } = await supabase
            .from('deployed_workflows')
            .update({
              // Removed 'name: workflowName' - preserve existing workflow name
              // Removed 'version' field - it causes constraint violation
              automation_sequence: yaml.load(content.yaml),
              automation_sequence_yaml: content.yaml, // Store YAML format as well
              current_version_id: newVersion.id,
              total_versions: (currentWorkflow?.total_versions || 0) + 1,
              github_path: filePath,
              github_sha: content.metadata.sha,
              github_ref: branch,
              github_sync_status: 'synced',
              github_last_synced_at: new Date().toISOString(),
              status: isDevelopment ? 'draft' : 'deployed',
            })
            .eq('id', existing.id);

          if (error) {
            results.errors.push(
              `${folderName}: Update failed - ${error.message}`
            );
          } else {
            // Fetch and upload only CHANGED JS files
            const changedFiles = changedJsFiles.get(folderName) || [];

            if (changedFiles.length > 0) {
              console.log(
                `📦 Processing ${changedFiles.length} changed JS files in ${folderName}...`
              );

              // Fetch only the changed files
              const jsFiles = await fetchChangedFiles(changedFiles, branch);

              if (jsFiles.length > 0) {
                console.log(
                  `📤 Uploading ${jsFiles.length} changed files to storage...`
                );

                const fileManager = new WorkflowFileManager();

                // Upload files one at a time to avoid timeout
                let uploadedCount = 0;
                let totalSize = 0;

                for (const file of jsFiles) {
                  console.log(`  Uploading: ${file.path}`);

                  const singleFileResult =
                    await fileManager.uploadWorkflowFiles(
                      existing.id,
                      newVersionNumber,
                      [file], // Upload one file at a time
                      undefined
                    );

                  if (singleFileResult.success) {
                    uploadedCount++;
                    totalSize += file.content.length;
                    console.log(`    ✓ Uploaded ${file.path}`);
                  } else {
                    console.error(
                      `    ✗ Failed to upload ${file.path}: ${singleFileResult.error}`
                    );
                  }
                }

                // Update workflow metadata after all files uploaded
                if (uploadedCount > 0) {
                  await supabase
                    .from('deployed_workflows')
                    .update({
                      requires_files: true,
                      files_config: {
                        file_count: uploadedCount,
                        total_size: totalSize,
                        subdirectory: null,
                        last_updated: new Date().toISOString(),
                      },
                    })
                    .eq('id', existing.id);

                  console.log(
                    `✅ Uploaded ${uploadedCount}/${jsFiles.length} changed files for workflow ${existing.id}`
                  );
                }
              } else {
                console.log(
                  `⚠️ Could not fetch changed files for ${folderName}`
                );
              }
            } else {
              console.log(`ℹ️ No JS files changed in ${folderName}`);
            }

            results.updated.push(`${workflowName} (v${newVersionNumber})`);
          }
        } else {
          // Workflow doesn't exist - create it
          console.log(
            `🆕 Creating new workflow: "${workflowName}" in folder ${folderName}`
          );

          // Parse YAML first to ensure it's valid
          let parsedYaml;
          try {
            parsedYaml = yaml.load(content.yaml);
            if (!parsedYaml) {
              throw new Error('YAML parsed to null/undefined');
            }
            console.log(
              `✅ YAML parsed successfully, type: ${typeof parsedYaml}`
            );
          } catch (yamlError) {
            const errorMsg =
              yamlError instanceof Error
                ? yamlError.message
                : 'Unknown YAML error';
            console.error(
              `❌ Failed to parse YAML for ${folderName}: ${errorMsg}`
            );
            results.errors.push(`${folderName}: Invalid YAML - ${errorMsg}`);
            continue; // Skip this workflow
          }

          const { data: newWorkflow, error: createError } = await supabase
            .from('deployed_workflows')
            .insert({
              name: workflowName,
              status: isDevelopment ? 'draft' : 'deployed',
              automation_sequence: parsedYaml,
              automation_sequence_yaml: content.yaml,
              github_folder: folderName,
              github_path: filePath,
              github_sha: content.metadata.sha,
              github_ref: branch,
              github_sync_status: 'synced',
              github_last_synced_at: new Date().toISOString(),
              version: '1.0.0',
              total_versions: 1,
              // Default to primary Mediar organization for all workflows created from GitHub
              organization_id: orgPrefix || MEDIAR_ORG_IDS[0],
              created_by: 'user_REDACTED', // Louis's Clerk ID - GitHub-synced workflows
            })
            .select()
            .single();

          if (createError) {
            console.error(
              `❌ Failed to create workflow ${folderName}: ${createError.message}`
            );
            results.errors.push(
              `${folderName}: Create failed - ${createError.message}`
            );
          } else {
            console.log(
              `✅ Created workflow ${workflowName} (ID: ${newWorkflow.id})`
            );
            // Create initial version entry (inactive initially)
            console.log(
              `📝 Creating initial version 1.0.0 for new workflow ${newWorkflow.id}...`
            );
            const { data: initialVersion, error: versionError } = await supabase
              .from('deployed_workflow_versions')
              .insert({
                workflow_id: newWorkflow.id,
                version_number: '1.0.0',
                automation_sequence_yaml: content.yaml,
                automation_sequence: parsedYaml,
                preferred_format: 'yaml',
                is_active: false, // Start inactive
                change_notes: `Created from GitHub: ${content.metadata.sha.substring(0, 7)}`,
              })
              .select()
              .single();

            if (versionError) {
              console.error(
                `❌ Initial version creation failed for ${folderName}: ${versionError.message}`
              );
              console.error(
                `   Full error details:`,
                JSON.stringify(versionError, null, 2)
              );

              // CRITICAL: Delete the workflow we just created since version creation failed
              console.log(
                `🔄 Rolling back workflow ${newWorkflow.id} due to version creation failure...`
              );
              await supabase
                .from('deployed_workflows')
                .delete()
                .eq('id', newWorkflow.id);
              console.log(`✅ Rolled back workflow ${newWorkflow.id}`);

              results.errors.push(
                `${folderName}: Version creation failed - ${versionError.message}`
              );
            } else {
              console.log(
                `✅ Created initial version 1.0.0 (ID: ${initialVersion.id})`
              );

              // Activate the initial version using the RPC function
              console.log(`🔄 Activating initial version 1.0.0...`);
              const { error: activateError } = await supabase.rpc(
                'activate_workflow_version',
                {
                  p_workflow_id: newWorkflow.id,
                  p_version_number: '1.0.0',
                }
              );

              if (activateError) {
                console.error(
                  `❌ Failed to activate initial version: ${activateError.message}`
                );
              } else {
                console.log(`✅ Activated initial version 1.0.0`);
              }

              // Update workflow to point to this version
              await supabase
                .from('deployed_workflows')
                .update({ current_version_id: initialVersion.id })
                .eq('id', newWorkflow.id);

              // For new workflows, we need to fetch ALL JS files (not just changed ones)
              // since this is the initial upload
              const { jsFiles, subdirectory } = await fetchWorkflowFiles(
                folderName,
                branch
              );

              if (jsFiles.length > 0) {
                console.log(
                  `📦 Found ${jsFiles.length} JS files in ${folderName}, uploading to storage...`
                );

                const fileManager = new WorkflowFileManager();

                // Upload files one at a time to avoid timeouts
                let uploadedCount = 0;
                let totalSize = 0;

                for (const file of jsFiles) {
                  console.log(
                    `  Uploading ${file.path} (${uploadedCount + 1}/${jsFiles.length})...`
                  );

                  const uploadResult = await fileManager.uploadWorkflowFiles(
                    newWorkflow.id,
                    '1.0.0',
                    [file], // Upload single file
                    subdirectory
                  );

                  if (uploadResult.success) {
                    uploadedCount++;
                    totalSize += file.content.length;
                    console.log(`    ✓ Uploaded ${file.path}`);
                  } else {
                    console.error(
                      `    ✗ Failed to upload ${file.path}: ${uploadResult.error}`
                    );
                  }
                }

                // Update workflow metadata
                if (uploadedCount > 0) {
                  await supabase
                    .from('deployed_workflows')
                    .update({
                      requires_files: true,
                      files_config: {
                        file_count: uploadedCount,
                        total_size: totalSize,
                        subdirectory: subdirectory || null,
                        last_updated: new Date().toISOString(),
                      },
                    })
                    .eq('id', newWorkflow.id);

                  console.log(
                    `✅ Uploaded ${uploadedCount}/${jsFiles.length} files for new workflow ${newWorkflow.id}`
                  );
                }
              } else {
                console.log(
                  `ℹ️ No JS files found in new workflow ${folderName}`
                );
              }

              results.created.push(workflowName);
            }
          }
        }

        // Log sync operation
        await supabase.from('github_workflow_sync_log').insert({
          workflow_id: existing?.id,
          operation: 'webhook_sync',
          github_path: filePath,
          github_sha: content.metadata.sha,
          status: 'success',
        });
      } catch (error) {
        console.error(`Error processing ${folderName}:`, error);
        results.errors.push(
          `${folderName}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return NextResponse.json({
      success: results.errors.length === 0,
      message: `Processed ${changedWorkflows.size} workflows`,
      branch,
      results,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

function verifyWebhookSignature(
  body: string,
  signature: string | null
): boolean {
  if (!signature || !process.env.GITHUB_WEBHOOK_SECRET) {
    console.warn('No webhook signature or secret configured');
    return false;
  }

  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(body).digest('hex');

  const signatureBuffer = Buffer.from(signature);
  const digestBuffer = Buffer.from(digest);

  if (signatureBuffer.length !== digestBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
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
      ref: branch,
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
        ref: branch,
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
          content,
        });
      }
    }

    return { jsFiles, subdirectory: detectedSubdir };
  } catch (error) {
    console.error(
      `Error fetching files from GitHub folder ${folderName}:`,
      error
    );
    return { jsFiles: [] };
  }
}

/**
 * Check if a GitHub folder still contains any YAML workflow files
 * Used to prevent premature deletion when multiple YAMLs exist in one folder
 */
async function checkGitHubFolderForYamls(
  folderName: string,
  branch: string = 'main'
): Promise<boolean> {
  try {
    console.log(
      `🔍 Checking GitHub folder ${folderName} for remaining YAML files...`
    );

    const { data: contents } = await octokit.repos.getContent({
      owner: 'mediar-ai',
      repo: 'workflows',
      path: folderName,
      ref: branch,
    });

    if (!Array.isArray(contents)) {
      return false;
    }

    // Check for any workflow YAML files
    const yamlFiles = contents.filter(
      file =>
        file.type === 'file' && /^(workflow|terminator)\.ya?ml$/.test(file.name)
    );

    const hasYamls = yamlFiles.length > 0;
    console.log(
      `   ${hasYamls ? '✓' : '✗'} Found ${yamlFiles.length} YAML file(s) in ${folderName}`
    );

    return hasYamls;
  } catch (error) {
    // If folder doesn't exist (404), no YAMLs remain
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      error.status === 404
    ) {
      console.log(`   ✗ Folder ${folderName} not found (deleted or empty)`);
      return false;
    }

    console.error(
      `⚠️ Error checking folder ${folderName}:`,
      error instanceof Error ? error.message : error
    );
    // On error, assume YAMLs might exist (safe default - don't delete)
    return true;
  }
}

/**
 * Fetch only specific changed files from GitHub
 * More efficient than fetching all files in a folder
 */
async function fetchChangedFiles(
  changedFilePaths: string[], // e.g., ["ExampleClient_1/add_adjustments.js"]
  branch: string = 'main'
): Promise<WorkflowFile[]> {
  const jsFiles: WorkflowFile[] = [];

  // Filter for JS files only
  const jsFilePaths = changedFilePaths.filter(path => path.endsWith('.js'));

  if (jsFilePaths.length === 0) {
    console.log('No JavaScript files in the changed files list');
    return [];
  }

  console.log(
    `📄 Fetching ${jsFilePaths.length} changed JS files from GitHub...`
  );

  // Fetch each file one by one
  for (const filePath of jsFilePaths) {
    try {
      console.log(`  Fetching: ${filePath}`);

      const { data: fileData } = await octokit.repos.getContent({
        owner: 'mediar-ai',
        repo: 'workflows',
        path: filePath,
        ref: branch,
      });

      if ('content' in fileData && fileData.content) {
        // Decode base64 content
        const content = Buffer.from(fileData.content, 'base64');

        // Extract relative path (remove folder prefix)
        const folderName = filePath.split('/')[0];
        const relativePath = filePath.replace(`${folderName}/`, '');

        jsFiles.push({
          path: relativePath,
          content,
        });

        console.log(`    ✓ Fetched ${relativePath} (${content.length} bytes)`);
      }
    } catch (error) {
      console.error(
        `    ✗ Failed to fetch ${filePath}:`,
        error instanceof Error ? error.message : error
      );
      // Continue with other files even if one fails
    }
  }

  console.log(`📦 Successfully fetched ${jsFiles.length} JS files`);
  return jsFiles;
}

/**
 * Fetch all TypeScript workflow files from GitHub (recursively)
 */
async function fetchTypeScriptWorkflowFiles(
  folderPath: string,
  branch: string = 'main'
): Promise<WorkflowFile[]> {
  const files: WorkflowFile[] = [];

  async function fetchRecursive(path: string) {
    try {
      const { data: contents } = await octokit.repos.getContent({
        owner: 'mediar-ai',
        repo: 'workflows',
        path,
        ref: branch,
      });

      if (!Array.isArray(contents)) {
        // Single file
        if (
          'content' in contents &&
          contents.content &&
          /\.(ts|js|json)$/.test(contents.name)
        ) {
          const relativePath = contents.path.replace(`${folderPath}/`, '');
          const content = Buffer.from(contents.content, 'base64');
          files.push({ path: relativePath, content });
        }
        return;
      }

      // Directory - process each item
      for (const item of contents) {
        if (item.type === 'dir') {
          await fetchRecursive(item.path);
        } else if (item.type === 'file' && /\.(ts|js|json)$/.test(item.name)) {
          // Fetch file content
          const { data: fileData } = await octokit.repos.getContent({
            owner: 'mediar-ai',
            repo: 'workflows',
            path: item.path,
            ref: branch,
          });

          if ('content' in fileData && fileData.content) {
            const relativePath = item.path.replace(`${folderPath}/`, '');
            const content = Buffer.from(fileData.content, 'base64');
            files.push({ path: relativePath, content });
          }
        }
      }
    } catch (error) {
      console.error(
        `Error fetching ${path}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  await fetchRecursive(folderPath);
  return files;
}
