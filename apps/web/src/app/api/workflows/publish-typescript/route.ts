/**
 * API Route: POST /api/workflows/publish-typescript
 *
 * Publishes a TypeScript workflow from the desktop app to the cloud.
 * Uses folder_id (UUID) as the canonical identifier via github_folder column.
 *
 * Flow:
 * 1. Create/update workflow in database
 * 2. Push files to GitHub (mediar-ai/workflows repo)
 * 3. GitHub Actions creates a release (triggered by push)
 * 4. Release webhook updates github_release_url (for download)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseTypeScriptWorkflow } from '@/lib/typescript-workflow-parser';
import { getAuthenticatedOctokit, isGitHubAppConfigured } from '@/lib/github-app-auth';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const GITHUB_OWNER = 'mediar-ai';
const GITHUB_REPO = 'workflows';
const GITHUB_BRANCH = 'main';

interface PublishRequest {
  folder_id: string; // UUID - used as github_folder in database
  name: string;
  description?: string;
  terminator_ts: string; // Content of src/terminator.ts
  files: { path: string; content: string }[]; // All TS files
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId: effectiveOrgId, email, userId } = await getEffectiveOrgId();

    if (!effectiveOrgId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: PublishRequest = await request.json();
    const { folder_id, name, description, terminator_ts } = body;

    if (!folder_id || !name || !terminator_ts) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: folder_id, name, terminator_ts' },
        { status: 400 }
      );
    }

    const userIdentifier = userId || null; // Store Clerk user ID for ownership checks
    console.log(`📤 Publishing TypeScript workflow "${name}" (folder: ${folder_id}) for org: ${effectiveOrgId}`);

    // Parse the TypeScript workflow
    let metadata;
    try {
      metadata = parseTypeScriptWorkflow(terminator_ts);
      console.log(`✅ Parsed TypeScript workflow: ${metadata.steps?.length || 0} steps`);
    } catch (parseError) {
      console.error('❌ Failed to parse TypeScript workflow:', parseError);
      return NextResponse.json(
        { success: false, error: `Failed to parse workflow: ${parseError}` },
        { status: 400 }
      );
    }

    // Look up existing workflow by github_folder (UUID)
    const { data: existingWorkflow } = await supabase
      .from('deployed_workflows')
      .select('id, organization_id, uuid')
      .eq('github_folder', folder_id)
      .single();

    let workflowId: number;
    let actualUpdatedAt: string;

    if (existingWorkflow) {
      // Check write permission using centralized helper
      const { checkWorkflowAccess } = await import('@/lib/workflow-permissions');
      const access = await checkWorkflowAccess(effectiveOrgId, existingWorkflow.uuid);

      if (!access.canWrite) {
        console.log(`[Publish] Access denied: org=${effectiveOrgId}, workflow=${folder_id}, level=${access.accessLevel}`);
        return NextResponse.json(
          { success: false, error: 'Not authorized to update this workflow' },
          { status: 403 }
        );
      }

      workflowId = existingWorkflow.id;
      console.log(`🔄 Updating existing workflow ID: ${workflowId} (access: ${access.accessLevel})`);

      // Update workflow metadata including step_count from typescript metadata
      // Select back content_updated_at to get the actual DB timestamp (used for sync comparison)
      const now = new Date().toISOString();
      const { data: updatedWorkflow, error: updateError } = await supabase
        .from('deployed_workflows')
        .update({
          name,
          description: description || metadata.description,
          step_count: metadata.steps?.length || 0,
          updated_at: now,
          content_updated_at: now, // Track content changes separately from metadata changes
        })
        .eq('id', workflowId)
        .select('content_updated_at')
        .single();

      if (updateError || !updatedWorkflow) {
        console.error('❌ Failed to update workflow:', updateError);
        return NextResponse.json(
          { success: false, error: `Failed to update workflow: ${updateError?.message}` },
          { status: 500 }
        );
      }

      actualUpdatedAt = updatedWorkflow.content_updated_at;

    } else {
      // Create new workflow
      console.log(`🆕 Creating new workflow: "${name}" with github_folder: ${folder_id}`);

      const now = new Date().toISOString();
      const { data: newWorkflow, error: createError } = await supabase
        .from('deployed_workflows')
        .insert({
          name,
          description: description || metadata.description,
          organization_id: effectiveOrgId,
          created_by: userIdentifier,
          github_folder: folder_id, // UUID - canonical identifier
          uuid: folder_id, // Align uuid with github_folder so download creates matching local folder
          workflow_type: 'execution',
          status: 'draft',
          step_count: metadata.steps?.length || 0,
          automation_sequence: {}, // Empty object for TypeScript workflows (loaded from GitHub)
          updated_at: now, // Explicitly set updated_at for new workflows
          content_updated_at: now, // Track content changes separately from metadata changes
        })
        .select('id, content_updated_at')
        .single();

      if (createError || !newWorkflow) {
        console.error('❌ Failed to create workflow:', createError);
        return NextResponse.json(
          { success: false, error: `Failed to create workflow: ${createError?.message}` },
          { status: 500 }
        );
      }

      workflowId = newWorkflow.id;
      actualUpdatedAt = newWorkflow.content_updated_at;
      console.log(`✅ Created workflow with ID: ${workflowId}`);
    }

    // Create new version
    const { data: latestVersion } = await supabase
      .from('deployed_workflow_versions')
      .select('version_number')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Increment patch version
    let newVersionNumber = metadata.version || '1.0.0';
    if (latestVersion?.version_number) {
      const parts = latestVersion.version_number.split('.');
      const patch = parseInt(parts[2] || '0') + 1;
      newVersionNumber = `${parts[0]}.${parts[1]}.${patch}`;
    }

    console.log(`📝 Creating version ${newVersionNumber} for workflow ${workflowId}`);

    const { error: versionError } = await supabase
      .from('deployed_workflow_versions')
      .insert({
        workflow_id: workflowId,
        version_number: newVersionNumber,
        automation_sequence: metadata,
        automation_sequence_yaml: null,
        preferred_format: 'typescript',
        typescript_metadata: metadata,
        is_active: false,
        change_notes: 'Published from desktop app',
      });

    if (versionError) {
      console.error('❌ Version creation failed:', versionError);
      return NextResponse.json(
        { success: false, error: `Version creation failed: ${versionError.message}` },
        { status: 500 }
      );
    }

    // Push files to GitHub using GitHub App or PAT
    try {
      console.log(`📤 Pushing ${body.files?.length || 0} files to GitHub...`);
      const octokit = await getAuthenticatedOctokit();

        // Generate package.json for the workflow
        // Use @mediar-ai/workflow as the main runtime (matches desktop app template)
        const packageJson = {
          name: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          version: newVersionNumber,
          description: description || metadata.description || '',
          main: 'src/terminator.ts',
          scripts: {
            build: 'tsc --noEmit'
          },
          dependencies: {
            '@mediar-ai/workflow': 'latest'
          },
          devDependencies: {
            'typescript': '^5.0.0',
            '@types/node': '^20.0.0'
          }
        };

        // Collect all files to push
        const filesToPush: { path: string; content: string }[] = [
          { path: `${folder_id}/package.json`, content: JSON.stringify(packageJson, null, 2) },
        ];

        // Add terminator.ts
        filesToPush.push({ path: `${folder_id}/src/terminator.ts`, content: terminator_ts });

        // Add other TS files from the files array
        if (body.files && Array.isArray(body.files)) {
          for (const file of body.files) {
            // Skip terminator.ts if already in files array (avoid duplicate)
            if (file.path === 'src/terminator.ts') continue;
            filesToPush.push({ path: `${folder_id}/${file.path}`, content: file.content });
          }
        }

        let lastCommitSha: string | undefined;

        // Push each file to GitHub
        for (const file of filesToPush) {
          try {
            // Check if file exists to get its SHA
            let existingSha: string | undefined;
            try {
              const { data: existingFile } = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: file.path,
                ref: GITHUB_BRANCH,
              });
              if ('sha' in existingFile) {
                existingSha = existingFile.sha;
              }
            } catch {
              // File doesn't exist - that's OK
            }

            // Create or update the file
            const { data } = await octokit.repos.createOrUpdateFileContents({
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO,
              path: file.path,
              message: `Publish TypeScript workflow: ${name} v${newVersionNumber}`,
              content: Buffer.from(file.content).toString('base64'),
              branch: GITHUB_BRANCH,
              ...(existingSha && { sha: existingSha }),
            });

            lastCommitSha = data.commit.sha;
            console.log(`  ✅ Pushed: ${file.path}`);
          } catch (fileError) {
            console.error(`  ❌ Failed to push ${file.path}:`, fileError);
            // Continue with other files
          }
        }

        // Update workflow with GitHub sync status
        if (lastCommitSha) {
          // Create a GitHub release with the workflow files as a ZIP
          const tagName = `${folder_id}-v${newVersionNumber.replace(/\./g, '-')}`;
          let releaseUrl: string | undefined;

          try {
            // Create the release
            const { data: release } = await octokit.repos.createRelease({
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO,
              tag_name: tagName,
              name: `${name} v${newVersionNumber}`,
              body: `TypeScript workflow published from desktop app.\n\nUUID: ${folder_id}\nVersion: ${newVersionNumber}`,
              target_commitish: lastCommitSha,
            });

            console.log(`  ✅ Created release: ${release.html_url}`);

            // Create ZIP content for the release asset
            const JSZipModule = await import('jszip');
            const zip = new JSZipModule.default();

            // Add all files to the ZIP
            for (const file of filesToPush) {
              // Remove the UUID prefix from path for cleaner ZIP structure
              const zipPath = file.path.replace(`${folder_id}/`, '');
              zip.file(zipPath, file.content);
            }

            const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

            // Upload ZIP as release asset
            const { data: asset } = await octokit.repos.uploadReleaseAsset({
              owner: GITHUB_OWNER,
              repo: GITHUB_REPO,
              release_id: release.id,
              name: `workflow-${folder_id}.zip`,
              data: zipBuffer as unknown as string, // Buffer works but types expect string
              headers: {
                'content-type': 'application/zip',
                'content-length': zipBuffer.length,
              },
            });

            releaseUrl = asset.url; // API URL for downloading
            console.log(`  ✅ Uploaded release asset: ${asset.name}`);

          } catch (releaseError) {
            console.error('  ⚠️ Release creation failed (files still pushed):', releaseError);
            // Continue - files are on GitHub, just no release
          }

          // Update DB with sync status and release URL
          await supabase
            .from('deployed_workflows')
            .update({
              github_path: `${folder_id}/src/terminator.ts`,
              github_sha: lastCommitSha,
              github_ref: GITHUB_BRANCH,
              github_sync_status: 'synced',
              status: 'deployed', // Change from draft to deployed since it's now on GitHub
              ...(releaseUrl && { github_release_url: releaseUrl }),
              package_json_version: newVersionNumber,
            })
            .eq('id', workflowId);

          console.log(`✅ GitHub sync complete - commit: ${lastCommitSha.substring(0, 7)}${releaseUrl ? ', release created' : ''}`);
        }
    } catch (githubError) {
      console.error('❌ GitHub sync failed:', githubError);
      // Don't fail the whole request - DB is already updated
      // The workflow can still be manually synced later
    }

    console.log(`✅ Published TypeScript workflow: ID=${workflowId}, version=${newVersionNumber}`);

    return NextResponse.json({
      success: true,
      workflow_id: workflowId,
      version: newVersionNumber,
      step_count: metadata.steps?.length || 0,
      updated_at: actualUpdatedAt,
    });

  } catch (error) {
    console.error('❌ Error publishing TypeScript workflow:', error);
    return NextResponse.json(
      { success: false, error: `Internal error: ${error}` },
      { status: 500 }
    );
  }
}
