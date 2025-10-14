import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';
import { auth } from '@clerk/nextjs/server';
import { workflowLoader } from '@/lib/workflow-loader';
import { Octokit } from '@octokit/rest';

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
    method: 'POST'
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);

    // Use the new workflow loader with GitHub priority
    const loadedWorkflow = await workflowLoader.loadWorkflow(workflowIdNum);

    if (!loadedWorkflow) {
      const errorResponse = {
        success: false,
        error: `Workflow ${workflowIdNum} not found`,
        timestamp: new Date().toISOString()
      };

      // Cache the error response for documentation
      await cacheResponse({
        endpointPath: '/api/remote-workflows/[workflowId]',
        httpMethod: 'GET',
        statusCode: 404,
        responseBody: errorResponse,
        requestParams: { workflowId: workflowIdNum },
        executionTimeMs: 25
      });

      return NextResponse.json(errorResponse, { status: 404 });
    }

    // Get status from Supabase (metadata is always in Supabase)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    const supabase = createClient(supabaseUrl!, supabaseServiceKey!);

    const { data: workflowMeta } = await supabase
      .from('deployed_workflows')
      .select('status, description, category')
      .eq('id', workflowIdNum)
      .single();

    const status = workflowMeta?.status || 'active';

    // --- DYNAMICALLY GENERATE SAMPLE INPUTS ---
    let sampleInputs = {};
    try {
        if (loadedWorkflow.automation_sequence && Array.isArray(loadedWorkflow.automation_sequence) && loadedWorkflow.automation_sequence.length > 0) {
          const mainSequence = loadedWorkflow.automation_sequence[0];
          if (mainSequence.arguments && mainSequence.arguments.variables) {
            sampleInputs = mainSequence.arguments.variables;
          }
        }
    } catch (e) {
        console.error(`Error parsing variables for workflow ${workflowIdNum}:`, e);
    }
    // --- END DYNAMIC GENERATION ---

    // Build comprehensive workflow details
    const workflowDetails = {
      id: loadedWorkflow.id,
      name: loadedWorkflow.name,
      status: status,

      // Source information
      source: loadedWorkflow.metadata.source,
      ...(loadedWorkflow.metadata.github_path && {
        github_path: loadedWorkflow.metadata.github_path,
        github_sha: loadedWorkflow.metadata.github_sha
      }),

      // Execution Information
      trigger_info: {
        endpoint: `/api/remote-workflows/${workflowIdNum}/execute`,
        method: 'POST',
        required_headers: ['Content-Type: application/json'],
        status: status,
        is_executable: status === 'deployed'
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
}).then(response => response.json())`
      }
    };

    const responseData = {
      success: true,
      workflow: workflowDetails,
      timestamp: new Date().toISOString()
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/[workflowId]',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: { workflowId: workflowIdNum },
      executionTimeMs: 50 // placeholder
    });

    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('[ERROR] Error getting workflow details:', error);
    
    const errorResponse = {
      success: false,
      error: 'Failed to retrieve workflow details',
      details: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };

    // Cache the error response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/[workflowId]',
      httpMethod: 'GET',
      statusCode: 500,
      responseBody: errorResponse,
      requestParams: {},
      executionTimeMs: 25
    });
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to update workflow');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    const body = await request.json();

    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables are not set' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow info and verify ownership
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized update for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    // Build update object with only provided fields
    const updateData: any = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;

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

    console.log(`[SUCCESS] Updated workflow ${workflowIdNum} (${workflow.name})`);

    return NextResponse.json({
      success: true,
      workflow: data,
      message: 'Workflow updated successfully'
    });

  } catch (error) {
    console.error('[ERROR] Error updating workflow:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update workflow',
        details: error instanceof Error ? error.message : String(error)
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
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to delete workflow');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    console.log('🚨 Workflow ID from params:', workflowId);
    const workflowIdNum = parseInt(workflowId);

    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    console.log(`🔐 Delete request for workflow ${workflowIdNum} from user: ${authenticatedUserId}`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Supabase environment variables are not set' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow info and verify ownership
    const { data: workflow, error: fetchError } = await supabase
      .from('deployed_workflows')
      .select('id, name, status, created_by, created_at, github_folder, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (fetchError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow deletion if:
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized deletion for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to delete this workflow' },
        { status: 403 }
      );
    }

    console.log(`🔐 Authorization check passed - User ${authenticatedUserId} can delete workflow ${workflowIdNum}`);

    // Get user email for logging (optional, best effort)
    let userEmail = '';
    try {
      const { clerkClient } = await import('@clerk/nextjs/server');
      const client = await clerkClient();
      const user = await client.users.getUser(authenticatedUserId);
      userEmail = user.emailAddresses?.[0]?.emailAddress || '';
    } catch (error) {
      console.warn('⚠️ Failed to get user email from Clerk:', error);
      // Continue without email - not critical for deletion
    }

    // Check for any running or queued executions
    const { data: activeExecutions, error: executionsError } = await supabase
      .from('workflow_executions')
      .select('id, status')
      .eq('workflow_id', workflowIdNum)
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
          activeExecutions: activeExecutions.length
        },
        { status: 409 }
      );
    }

    // Get execution count for logging purposes
    const { count: executionCount } = await supabase
      .from('workflow_executions')
      .select('*', { count: 'exact', head: true })
      .eq('workflow_id', workflowIdNum);

    console.log(`🗑️ User ${authenticatedUserId} (${userEmail || 'email unknown'}) deleting workflow ${workflowIdNum} (${workflow.name}) with ${executionCount || 0} historical executions`);

    // Step 1: Delete from GitHub if workflow has github_folder
    if (workflow.github_folder) {
      const githubToken = process.env.GITHUB_TOKEN;

      if (!githubToken) {
        console.warn('⚠️ GITHUB_TOKEN not set - skipping GitHub deletion');
      } else {
        try {
          const octokit = new Octokit({ auth: githubToken });
          const owner = 'mediar-ai';
          const repo = 'workflows';

          console.log(`🗑️ Deleting GitHub folder: ${workflow.github_folder}`);

          // Get all files in the workflow folder
          const { data: contents } = await octokit.repos.getContent({
            owner,
            repo,
            path: workflow.github_folder,
          });

          if (Array.isArray(contents)) {
            console.log(`   Found ${contents.length} files to delete`);

            // Delete each file individually
            for (const file of contents) {
              try {
                await octokit.repos.deleteFile({
                  owner,
                  repo,
                  path: file.path,
                  message: `Delete ${file.name} (workflow deletion via UI by ${userEmail})`,
                  sha: file.sha,
                });
                console.log(`   ✅ Deleted: ${file.path}`);
              } catch (fileError) {
                console.error(`   ❌ Failed to delete ${file.path}:`, fileError);
              }
            }

            console.log(`✅ Deleted ${contents.length} files from GitHub folder: ${workflow.github_folder}`);
          }
        } catch (githubError) {
          console.error('❌ GitHub deletion failed:', githubError);
          // Continue with deletion even if GitHub fails
        }
      }
    } else {
      console.log('ℹ️ No github_folder - skipping GitHub deletion');
    }

    // Step 2: Delete storage files BEFORE deleting workflow record
    try {
      const { data: files } = await supabase
        .from('workflow_files')
        .select('storage_path')
        .eq('workflow_id', workflowIdNum);

      if (files && files.length > 0) {
        const storagePaths = files.map(f => f.storage_path);
        console.log(`🗑️ Deleting ${storagePaths.length} files from Supabase Storage`);

        const { error: storageError } = await supabase.storage
          .from('workflow-files')
          .remove(storagePaths);

        if (storageError) {
          console.error('⚠️ Warning: Failed to delete some storage files:', storageError);
        } else {
          console.log(`✅ Deleted ${storagePaths.length} files from storage`);
        }
      } else {
        console.log('ℹ️ No storage files to delete');
      }
    } catch (storageError) {
      console.error('❌ Storage deletion error:', storageError);
    }

    // Step 3: Delete database records in proper order

    // 3a. Delete all workflow executions (historical data)
    const { error: deleteExecutionsError } = await supabase
      .from('workflow_executions')
      .delete()
      .eq('workflow_id', workflowIdNum);

    if (deleteExecutionsError) {
      console.error('❌ Error deleting workflow executions:', deleteExecutionsError);
      return NextResponse.json(
        { success: false, error: 'Failed to delete workflow executions' },
        { status: 500 }
      );
    }

    // 3b. Delete workflow versions
    const { error: deleteVersionsError } = await supabase
      .from('deployed_workflow_versions')
      .delete()
      .eq('workflow_id', workflowIdNum);

    if (deleteVersionsError) {
      console.error('❌ Error deleting workflow versions:', deleteVersionsError);
      return NextResponse.json(
        { success: false, error: 'Failed to delete workflow versions' },
        { status: 500 }
      );
    }

    // 3c. Delete the main workflow record (CASCADE will delete workflow_files)
    const { error: deleteWorkflowError } = await supabase
      .from('deployed_workflows')
      .delete()
      .eq('id', workflowIdNum);

    if (deleteWorkflowError) {
      console.error('❌ Error deleting workflow:', deleteWorkflowError);
      return NextResponse.json(
        { success: false, error: 'Failed to delete workflow' },
        { status: 500 }
      );
    }

    console.log(`✅ Successfully deleted workflow ${workflowIdNum} (${workflow.name}) and ${executionCount || 0} executions`);

    return NextResponse.json({
      success: true,
      message: `Workflow "${workflow.name}" and all associated data deleted successfully`,
      deletedExecutions: executionCount || 0
    });

  } catch (error) {
    console.error('❌ Error in workflow deletion:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json(
      { success: false, error: 'Internal server error', details: errorMessage },
      { status: 500 }
    );
  }
}