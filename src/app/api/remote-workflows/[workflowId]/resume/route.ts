import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to resume workflow');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Initialize Supabase with service key to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    console.log('Resume API called with workflowId:', workflowId, 'resolved to:', workflowIdNum);

    // STEP 2: Get workflow info and verify ownership
    console.log('Querying database for workflow ID:', workflowIdNum);
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, status, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    console.log('Database result:', { workflow, workflowError });

    if (workflowError || !workflow) {
      console.log('Workflow not found or error:', workflowError);
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
    // Allow ANY member of an organization with access (not just admins)
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow resuming if:
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (!isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized resume for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to resume this workflow' },
        { status: 403 }
      );
    }

    if (workflow.status !== 'paused') {
      return NextResponse.json(
        { 
          success: false, 
          error: `Workflow ${workflowIdNum} is not paused (current status: ${workflow.status})` 
        },
        { status: 400 }
      );
    }

    // Resume the workflow: set status to 'deployed' and skip next cancellation check
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        status: 'deployed',
        skip_next_cancellation_check: true,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowIdNum);

    if (updateError) {
      console.error('Failed to resume workflow:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to resume workflow' },
        { status: 500 }
      );
    }

    console.log(`[SUCCESS] User ${authenticatedUserId} resumed workflow ${workflowIdNum} (${workflow.name})`);

    return NextResponse.json({
      success: true,
      message: `Workflow "${workflow.name}" resumed successfully`,
      workflow: {
        id: workflowIdNum,
        name: workflow.name,
        status: 'deployed',
        skip_next_cancellation_check: true
      }
    });

  } catch (error) {
    console.error('Error in resume workflow API:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
} 