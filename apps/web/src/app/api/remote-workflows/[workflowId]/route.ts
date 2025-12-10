import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';
import { auth } from '@clerk/nextjs/server';
import { workflowLoader } from '@/lib/workflow-loader';
import { Octokit } from '@octokit/rest';
import { getNumericWorkflowId, resolveWorkflowId } from '@/lib/workflow-id-resolver';

// Simple test endpoint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  console.log('🔵 POST test endpoint hit for workflow:', workflowId);
  return NextResponse.json({
    success: true,
    message: 'Test endpoint working',
    workflowId,
    method: 'POST',
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate (support both desktop Bearer tokens and Clerk sessions)
    let authenticatedUserId: string | null = null;
    let orgId: string | null | undefined = null;
    let has: any = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import(
        '@/lib/auth/validateDesktopToken'
      );
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
        orgId = validation.orgId;
        has = () => false; // Desktop auth doesn't support Clerk role checks
        console.log(
          `[Desktop Auth] Workflow GET authenticated for user: ${validation.email}`
        );
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
      orgId = clerkAuth.orgId;
      has = clerkAuth.has;
    }

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to workflow details');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Get status from Supabase (metadata is always in Supabase)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      const errorResponse = {
        success: false,
        error: resolveError || `Workflow ${workflowId} not found`,
        timestamp: new Date().toISOString(),
      };

      await cacheResponse({
        endpointPath: '/api/remote-workflows/[workflowId]',
        httpMethod: 'GET',
        statusCode: 404,
        responseBody: errorResponse,
        requestParams: { workflowId },
        executionTimeMs: 25,
      });

      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Use the new workflow loader with GitHub priority
    const loadedWorkflow = await workflowLoader.loadWorkflow(workflowIdNum);

    if (!loadedWorkflow) {
      const errorResponse = {
        success: false,
        error: `Workflow ${workflowIdNum} not found`,
        timestamp: new Date().toISOString(),
      };

      await cacheResponse({
        endpointPath: '/api/remote-workflows/[workflowId]',
        httpMethod: 'GET',
        statusCode: 404,
        responseBody: errorResponse,
        requestParams: { workflowId: workflowIdNum },
        executionTimeMs: 25,
      });

      return NextResponse.json(errorResponse, { status: 404 });
    }

    // STEP 2: Get workflow ownership data and verify authorization
    const { data: workflowOwnership, error: ownershipError } = await supabase
      .from('deployed_workflows')
      .select(
        'id, name, created_by, organization_id, status, description, category, github_folder'
      )
      .eq('id', workflowIdNum)
      .single();

    if (ownershipError || !workflowOwnership) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Use centralized RPC for access check (single DB call)
    const { checkWorkflowAccess } = await import('@/lib/workflow-permissions');
    const workflowUuid = loadedWorkflow.metadata?.github_folder || workflowOwnership.github_folder;
    const access = orgId && workflowUuid ? await checkWorkflowAccess(orgId, workflowUuid) : null;

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any workflow)
    // - User has any access level via RPC (owner, admin, write, read, public_read)
    if (!isMediarOrg && !isMediarAdmin && !access?.hasAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, level: ${access?.accessLevel}) attempted unauthorized read of workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    const isGloballyPublic = access?.accessLevel === 'public_read';

    const status = workflowOwnership.status || 'active';

    // --- DYNAMICALLY GENERATE SAMPLE INPUTS ---
    let sampleInputs = {};
    try {
      if (
        loadedWorkflow.automation_sequence &&
        Array.isArray(loadedWorkflow.automation_sequence) &&
        loadedWorkflow.automation_sequence.length > 0
      ) {
        const mainSequence = loadedWorkflow.automation_sequence[0];
        if (mainSequence.arguments && mainSequence.arguments.variables) {
          sampleInputs = mainSequence.arguments.variables;
        }
      }
    } catch (e) {
      console.error(
        `Error parsing variables for workflow ${workflowIdNum}:`,
        e
      );
    }
    // --- END DYNAMIC GENERATION ---

    // Build comprehensive workflow details
    const workflowDetails = {
      id: loadedWorkflow.id,
      name: loadedWorkflow.name,
      status: status,
      preferred_format: loadedWorkflow.preferred_format,
      typescript_metadata: loadedWorkflow.typescript_metadata,

      // Permission/Ownership Information
      created_by: workflowOwnership.created_by,
      organization_id: workflowOwnership.organization_id,
      is_public: isGloballyPublic,

      // Source information
      source: loadedWorkflow.metadata.source,
      ...(loadedWorkflow.metadata.github_path && {
        github_path: loadedWorkflow.metadata.github_path,
        github_sha: loadedWorkflow.metadata.github_sha,
      }),

      // Execution Information
      trigger_info: {
        endpoint: `/api/remote-workflows/${workflowIdNum}/execute`,
        method: 'POST',
        required_headers: ['Content-Type: application/json'],
        status: status,
        is_executable: status === 'deployed',
      },

      // Workflow Definition (from GitHub or Supabase)
      automation_sequence: loadedWorkflow.automation_sequence,

      // Usage Examples
      usage_examples: {
        curl_example: `curl -X POST \\
  ${process.env.VERCEL_URL || 'https://app.mediar.ai'}/api/remote-workflows/${workflowIdNum}/execute \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(sampleInputs, null, 2)}'`,

        javascript_example: `fetch('/api/remote-workflows/${workflowIdNum}/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${JSON.stringify(sampleInputs)})
}).then(response => response.json())`,
      },
    };

    const responseData = {
      success: true,
      workflow: workflowDetails,
      timestamp: new Date().toISOString(),
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/[workflowId]',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: { workflowId: workflowIdNum },
      executionTimeMs: 50, // placeholder
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[ERROR] Error getting workflow details:', error);

    const errorResponse = {
      success: false,
      error: 'Failed to retrieve workflow details',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };

    // Cache the error response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/[workflowId]',
      httpMethod: 'GET',
      statusCode: 500,
      responseBody: errorResponse,
      requestParams: {},
      executionTimeMs: 25,
    });

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate (support both desktop Bearer tokens and Clerk sessions)
    let authenticatedUserId: string | null = null;
    let orgId: string | null | undefined = null;
    let userEmail: string | null = null;
    let has: any = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import(
        '@/lib/auth/validateDesktopToken'
      );
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
        orgId = validation.orgId;
        userEmail = validation.email || null;
        has = () => false; // Desktop auth doesn't support Clerk role checks
        console.log(
          `[Desktop Auth] Workflow update authenticated for user: ${validation.email}`
        );
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
      orgId = clerkAuth.orgId;
      has = clerkAuth.has;
      userEmail = (clerkAuth.sessionClaims?.email as string) || null;
    }

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to update workflow');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const body = await request.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables are not set' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, created_by, organization_id, is_public, github_path, github_folder'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;
    const workflowIdNum = workflow.id;

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Use centralized RPC for access check (single DB call)
    const { checkWorkflowAccess } = await import('@/lib/workflow-permissions');
    const workflowUuid = workflow.github_folder;
    const access = orgId && workflowUuid ? await checkWorkflowAccess(orgId, workflowUuid) : null;

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow)
    // - User has write access via RPC (owner, admin, write)
    if (!isMediarOrg && !isMediarAdmin && !access?.canWrite) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, level: ${access?.accessLevel}) attempted unauthorized update for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        {
          error:
            'Forbidden - You do not have permission to modify this workflow',
        },
        { status: 403 }
      );
    }

    // Build update object with only provided fields
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined)
      updateData.description = body.description;
    if (body.tags !== undefined) updateData.tags = body.tags;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('deployed_workflows')
      .update(updateData)
      .eq('id', workflowIdNum)
      .select()
      .single();

    if (error) {
      console.error('Error updating workflow:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to update workflow' },
        { status: 500 }
      );
    }

    console.log(
      `[SUCCESS] Updated workflow ${workflowIdNum} (${workflow.name})`
    );

    // Sync name/description change to GitHub package.json (fire-and-forget)
    // This is the single source of truth for TypeScript workflows
    if ((body.name || body.description !== undefined) && workflow.github_path) {
      console.log(
        `📤 Syncing metadata to GitHub package.json (async) for workflow ${workflowIdNum}...`
      );

      // Fire-and-forget: update package.json without blocking
      (async () => {
        try {
          const { githubWorkflowManager } = await import(
            '@/lib/github-workflow-manager'
          );

          // Update package.json (will gracefully skip if not found - legacy YAML workflow)
          const packageResult = await githubWorkflowManager.updatePackageJson(
            workflowIdNum,
            {
              name: body.name || undefined,
              description: body.description,
            },
            { email: userEmail || undefined }
          );

          if (packageResult.success) {
            if (packageResult.path) {
              console.log(
                `✅ GitHub package.json updated: ${packageResult.path}`
              );
            } else if (packageResult.error?.includes('legacy')) {
              console.log(
                `ℹ️ Skipped package.json update (legacy YAML workflow)`
              );
            }
          } else {
            console.warn(
              `⚠️ GitHub package.json sync failed: ${packageResult.error}`
            );
          }

          // Also update YAML metadata comment if name changed
          if (body.name) {
            const { data: latestVersion } = await supabase
              .from('deployed_workflow_versions')
              .select('automation_sequence_yaml')
              .eq('workflow_id', workflowIdNum)
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            if (latestVersion?.automation_sequence_yaml) {
              const result = await githubWorkflowManager.saveWorkflow(
                body.name,
                latestVersion.automation_sequence_yaml,
                false,
                `Rename workflow: ${workflow.name} → ${body.name}`,
                false,
                workflowIdNum,
                workflow.organization_id || undefined,
                { email: userEmail || undefined }
              );

              if (result.success) {
                console.log(`✅ GitHub YAML metadata updated: ${result.path}`);
              } else {
                console.warn(`⚠️ GitHub YAML sync failed: ${result.error}`);
              }
            }
          }
        } catch (error) {
          console.error('GitHub metadata sync error:', error);
        }
      })();
    }

    return NextResponse.json({
      success: true,
      workflow: data,
      message: 'Workflow updated successfully',
    });
  } catch (error) {
    console.error('[ERROR] Error updating workflow:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update workflow',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  console.log('🚨 DELETE route hit!');
  console.log('🚨 Request URL:', request.url);

  try {
    // STEP 1: Authenticate (support both desktop Bearer tokens and Clerk sessions)
    let authenticatedUserId: string | null = null;
    let orgId: string | null | undefined = null;
    let userEmail: string | null = null;
    let has: any = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import(
        '@/lib/auth/validateDesktopToken'
      );
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
        orgId = validation.orgId;
        userEmail = validation.email || null;
        has = () => false; // Desktop auth doesn't support Clerk role checks
        console.log(
          `[Desktop Auth] Workflow deletion authenticated for user: ${validation.email}`
        );
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
      orgId = clerkAuth.orgId;
      has = clerkAuth.has;
      userEmail = (clerkAuth.sessionClaims?.email as string) || null;
    }

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to delete workflow');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    console.log('🚨 Workflow ID from params:', workflowId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables are not set' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, status, created_by, created_at, github_folder, github_path, organization_id, is_public'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const workflow = resolveResult.workflow;

    console.log(
      `🔐 Delete request for workflow ${workflow.id} (${workflow.name}) from user: ${authenticatedUserId}`
    );

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const {
      isMediarOrg: isMediarOrgDelete,
      isMediarAdmin: isMediarAdminDelete,
    } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Use centralized RPC for access check (single DB call)
    const { checkWorkflowAccess } = await import('@/lib/workflow-permissions');
    const workflowUuid = workflow.github_folder;
    const access = orgId && workflowUuid ? await checkWorkflowAccess(orgId, workflowUuid) : null;

    // Allow deletion if:
    // - User is in Mediar org or is a Mediar admin (can delete any workflow)
    // - User has admin access via RPC (owner or shared with admin level)
    if (!isMediarOrgDelete && !isMediarAdminDelete && !access?.canAdmin) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, level: ${access?.accessLevel}) attempted unauthorized deletion for workflow ${workflow.id}`
      );
      return NextResponse.json(
        {
          error:
            'Forbidden - You do not have permission to delete this workflow',
        },
        { status: 403 }
      );
    }

    console.log(
      `🔐 Authorization check passed - User ${authenticatedUserId} can delete workflow ${workflow.id}`
    );

    // Check for any running or queued executions
    const { data: activeExecutions, error: executionsError } = await supabase
      .from('workflow_executions')
      .select('id, status')
      .eq('workflow_id', workflow.id)
      .in('status', ['running', 'queued']);

    if (executionsError) {
      return NextResponse.json(
        { success: false, error: 'Failed to check active executions' },
        { status: 500 }
      );
    }

    // If there are active executions, prevent deletion
    if (activeExecutions && activeExecutions.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot delete workflow with ${activeExecutions.length} active execution(s). Cancel or wait for them to complete first.`,
          activeExecutions: activeExecutions.length,
        },
        { status: 409 }
      );
    }

    // Get execution count for logging purposes
    const { count: executionCount } = await supabase
      .from('workflow_executions')
      .select('*', { count: 'exact', head: true })
      .eq('workflow_id', workflow.id);

    console.log(
      `🗑️ User ${authenticatedUserId} (${userEmail || 'unknown'}) deleting workflow ${workflow.id} (${workflow.name}) with ${executionCount || 0} historical executions`
    );

    // Step 1: Delete from GitHub if workflow has github_path (fire-and-forget for faster response)
    // Use github_path (full path like org-{orgId}/335_test13/workflow.yaml) instead of github_folder
    // to ensure we have the correct path including org prefix
    const githubFolderPath = workflow.github_path?.replace(
      /\/workflow\.yaml$/,
      ''
    );
    if (githubFolderPath) {
      const githubToken = process.env.GITHUB_TOKEN;

      if (!githubToken) {
        console.warn('⚠️ GITHUB_TOKEN not set - skipping GitHub deletion');
      } else {
        console.log(
          `🗑️ Queuing GitHub folder deletion (async): ${githubFolderPath}`
        );

        // Fire-and-forget: don't await GitHub deletion
        (async () => {
          try {
            const octokit = new Octokit({ auth: githubToken });
            const owner = 'mediar-ai';
            const repo = 'workflows';

            // Get all files in the workflow folder
            const { data: contents } = await octokit.repos.getContent({
              owner,
              repo,
              path: githubFolderPath,
            });

            if (Array.isArray(contents)) {
              console.log(
                `[GitHub Async] Found ${contents.length} files to delete in ${githubFolderPath}`
              );

              // Build commit message with user email
              const commitUserInfo = userEmail ? `By: ${userEmail}` : '';
              const commitMessage = `Delete workflow.yaml (workflow deletion via UI)${commitUserInfo ? `\n\n${commitUserInfo}` : ''}`;

              // Delete each file individually
              for (const file of contents) {
                try {
                  await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: file.path,
                    message:
                      file.name === 'workflow.yaml'
                        ? commitMessage
                        : `Delete ${file.name} (workflow deletion via UI)\n\n${commitUserInfo}`,
                    sha: file.sha,
                  });
                  console.log(`[GitHub Async] ✅ Deleted: ${file.path}`);
                } catch (fileError) {
                  console.error(
                    `[GitHub Async] ❌ Failed to delete ${file.path}:`,
                    fileError
                  );
                }
              }

              console.log(
                `[GitHub Async] ✅ Completed deletion of ${contents.length} files from: ${githubFolderPath}`
              );
            }
          } catch (githubError: any) {
            if (githubError?.status === 404) {
              console.log(
                `[GitHub Async] ℹ️ Folder not found in GitHub (already deleted or never synced): ${githubFolderPath}`
              );
            } else {
              console.error(
                `[GitHub Async] ❌ GitHub deletion failed for ${githubFolderPath}:`,
                githubError
              );
            }
          }
        })();
      }
    } else {
      console.log('ℹ️ No github_path - skipping GitHub deletion');
    }

    // Step 2: Delete storage files BEFORE archiving workflow
    try {
      const { data: files } = await supabase
        .from('workflow_files')
        .select('storage_path')
        .eq('workflow_id', workflow.id);

      if (files && files.length > 0) {
        const storagePaths = files.map(f => f.storage_path);
        console.log(
          `🗑️ Deleting ${storagePaths.length} files from Supabase Storage`
        );

        const { error: storageError } = await supabase.storage
          .from('workflow-files')
          .remove(storagePaths);

        if (storageError) {
          console.error(
            '⚠️ Warning: Failed to delete some storage files:',
            storageError
          );
        } else {
          console.log(`✅ Deleted ${storagePaths.length} files from storage`);
        }
      } else {
        console.log('ℹ️ No storage files to delete');
      }
    } catch (storageError) {
      console.error('❌ Storage deletion error:', storageError);
    }

    // Step 3: Archive workflow using database function
    // This will:
    // - Move workflow to deleted_workflows (archive)
    // - Move versions to deleted_workflow_versions (archive)
    // - Move files to deleted_workflow_files (archive)
    // - Set workflow_id = NULL in workflow_executions (preserve execution history)
    // - Delete workflow from deployed_workflows (CASCADE cleans up other tables)
    console.log(
      `📦 Archiving workflow ${workflow.id} (${workflow.name}) with ${executionCount || 0} executions`
    );

    // Build archived_by string with user context (no email)
    const archivedByStr = [`user:${authenticatedUserId}`, userEmail]
      .filter(Boolean)
      .join(':');

    const { data: archiveResult, error: archiveError } = await supabase.rpc(
      'archive_workflow',
      {
        p_workflow_id: workflow.id,
        p_archived_by: archivedByStr,
        p_deletion_reason: `Manual deletion from UI (Danger Zone)`,
      }
    );

    if (archiveError) {
      console.error('❌ Error archiving workflow:', archiveError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to archive workflow',
          details: archiveError.message,
        },
        { status: 500 }
      );
    }

    console.log(
      `✅ Successfully archived workflow ${workflow.id} (${workflow.name})`
    );
    console.log(`   Archive summary:`, archiveResult);

    return NextResponse.json({
      success: true,
      message: `Workflow "${workflow.name}" archived successfully. Execution history preserved.`,
      archived: true,
      archiveDetails: archiveResult,
    });
  } catch (error) {
    console.error('❌ Error in workflow deletion:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}
