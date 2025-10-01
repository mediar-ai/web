import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';
import { auth } from '@clerk/nextjs/server';
import { workflowLoader } from '@/lib/workflow-loader';

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
    const { workflowId } = await params;
    console.log('🚨 Workflow ID from params:', workflowId);
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