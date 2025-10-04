import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

// Also export POST for testing
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  return DELETE(request, { params });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    // Check authentication
    const { userId } = await auth();
    
    console.log(`🔐 Delete request for workflow ${workflowIdNum} from user: ${userId || 'anonymous'}`);
    
    if (!userId) {
      console.log('❌ No userId found in auth');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user email from Clerk
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    
    let userEmail = '';
    try {
      const user = await client.users.getUser(userId);
      userEmail = user.emailAddresses?.[0]?.emailAddress || '';
      console.log(`🔐 User email: ${userEmail}`);
    } catch (error) {
      console.error('❌ Failed to get user email from Clerk:', error);
      return NextResponse.json(
        { success: false, error: 'Failed to verify user identity' },
        { status: 500 }
      );
    }

    // Hardcoded admin emails for maximum safety
    const ADMIN_EMAILS = ['louis@mediar.ai', 'matt@mediar.ai'];
    const canDelete = ADMIN_EMAILS.includes(userEmail.toLowerCase());
    
    console.log(`🔐 Permission check - User: ${userEmail}, Can Delete: ${canDelete}`);
    
    if (!canDelete) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Only louis@mediar.ai and matt@mediar.ai can delete workflows' 
        },
        { status: 403 }
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

    // First, check if workflow exists and get its details including github_folder
    const { data: workflow, error: fetchError } = await supabase
      .from('deployed_workflows')
      .select('id, name, status, created_by, created_at, github_folder')
      .eq('id', workflowIdNum)
      .single();

    if (fetchError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
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

    console.log(`🗑️ Admin ${userId} deleting workflow ${workflowIdNum} (${workflow.name}) with ${executionCount || 0} historical executions`);

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
          // Continue with deletion even if GitHub fails - orphaned GitHub files are less critical
          // than orphaned database records
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
          // Continue anyway - CASCADE will clean up DB records
        } else {
          console.log(`✅ Deleted ${storagePaths.length} files from storage`);
        }
      } else {
        console.log('ℹ️ No storage files to delete');
      }
    } catch (storageError) {
      console.error('❌ Storage deletion error:', storageError);
      // Continue anyway
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

    // 3c. Delete the main workflow record (CASCADE will delete workflow_files and other related records)
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
