import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveOrgId } from '@/lib/mediarAuth';
import { clerkClient, currentUser } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId: workflowIdParam } = await params;

    const { isMediarOrg } = await getEffectiveOrgId();

    // Check if user has @mediar.ai email or is matt@mediar.ai (super admin)
    const user = await currentUser();
    const userEmail = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase() || '';
    const hasMediarEmail = userEmail.endsWith('@mediar.ai');
    const isSuperAdmin = userEmail === 'matt@mediar.ai';

    // Only Mediar org, @mediar.ai users, or super admin can view organization access
    if (!isMediarOrg && !hasMediarEmail && !isSuperAdmin) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Mediar access required' },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowId, error: resolveError } = await getNumericWorkflowId(supabase, workflowIdParam);
    if (resolveError || workflowId === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowIdParam} not found` },
        { status: 404 }
      );
    }

    // Get current organization access for this workflow
    const { data: accessList, error } = await supabase
      .from('workflow_organization_access')
      .select('organization_id')
      .eq('workflow_id', workflowId);

    if (error) {
      throw new Error(`Failed to fetch access list: ${error.message}`);
    }

    // Get all organizations from Clerk (paginated to get all)
    const clerk = await clerkClient();
    const allOrganizations = [];
    let hasMore = true;
    let offset = 0;
    const limit = 100;

    while (hasMore) {
      const clerkOrganizations = await clerk.organizations.getOrganizationList({
        limit,
        offset,
      });

      allOrganizations.push(...clerkOrganizations.data);

      // Check if there are more organizations to fetch
      hasMore = clerkOrganizations.data.length === limit;
      offset += limit;
    }

    // Transform Clerk organizations to match our format
    const organizations = allOrganizations.map(org => ({
      id: org.id,
      name: org.name
    }));

    return NextResponse.json({
      success: true,
      organizations: organizations,
      assignedOrganizations: (accessList || []).map(a => a.organization_id),
    });
  } catch (error) {
    console.error('[ERROR] Failed to fetch workflow access:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch workflow access',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId: workflowIdParam } = await params;

    const { isMediarOrg } = await getEffectiveOrgId();

    // Check if user has @mediar.ai email or is matt@mediar.ai (super admin)
    const user = await currentUser();
    const userEmail = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase() || '';
    const hasMediarEmail = userEmail.endsWith('@mediar.ai');
    const isSuperAdmin = userEmail === 'matt@mediar.ai';

    // Only Mediar org, @mediar.ai users, or super admin can update organization access
    if (!isMediarOrg && !hasMediarEmail && !isSuperAdmin) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Mediar access required' },
        { status: 403 }
      );
    }

    const { organizationIds } = await request.json();

    if (!Array.isArray(organizationIds)) {
      return NextResponse.json(
        { success: false, error: 'organizationIds must be an array' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowId, error: resolveError } = await getNumericWorkflowId(supabase, workflowIdParam);
    if (resolveError || workflowId === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowIdParam} not found` },
        { status: 404 }
      );
    }

    // Get the workflow UUID for the access records
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('uuid')
      .eq('id', workflowId)
      .single();

    if (workflowError || !workflow) {
      throw new Error(`Failed to fetch workflow: ${workflowError?.message || 'not found'}`);
    }

    // First, remove all existing access for this workflow
    const { error: deleteError } = await supabase
      .from('workflow_organization_access')
      .delete()
      .eq('workflow_id', workflowId);

    if (deleteError) {
      throw new Error(`Failed to remove existing access: ${deleteError.message}`);
    }

    // Add new access entries (no longer forcing Mediar orgs)
    // Mediar admins can see all workflows via org switcher
    if (organizationIds.length > 0) {
      const accessEntries = organizationIds.map(orgId => ({
        workflow_id: workflowId,
        organization_id: orgId,
        workflow_uuid: workflow.uuid, // Required for check_org_workflow_access function
      }));

      const { error: insertError } = await supabase
        .from('workflow_organization_access')
        .insert(accessEntries);

      if (insertError) {
        throw new Error(`Failed to add organization access: ${insertError.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Organization access updated successfully',
    });
  } catch (error) {
    console.error('[ERROR] Failed to update workflow access:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update workflow access',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}