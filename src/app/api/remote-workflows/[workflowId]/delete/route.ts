import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

    // First, check if workflow exists and get its details including ownership
    const { data: workflow, error: fetchError } = await supabase
      .from('deployed_workflows')
      .select('id, name, status, created_by, created_at')
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

    // Start transaction by deleting in proper order
    
    // 1. Delete all workflow executions (historical data)
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

    // 2. Delete workflow versions
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

    // 3. Delete the main workflow record
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
