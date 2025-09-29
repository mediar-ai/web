import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveOrgId } from '@/lib/mediarAuth';
import { clerkClient, currentUser } from '@clerk/nextjs/server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId: workflowIdParam } = await params;
    const workflowId = parseInt(workflowIdParam);
    if (isNaN(workflowId)) {
      return NextResponse.json({ success: false, error: 'Invalid workflow ID' }, { status: 400 });
    }

    const { isMediarOrg } = await getEffectiveOrgId();

    // Check if user has @mediar.ai email
    const user = await currentUser();
    const hasMediarEmail = user?.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    // Only Mediar org or @mediar.ai users can view organization access
    if (!isMediarOrg && !hasMediarEmail) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Mediar access required' },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get current organization access for this workflow
    const { data: accessList, error } = await supabase
      .from('workflow_organization_access')
      .select('organization_id')
      .eq('workflow_id', workflowId);

    if (error) {
      throw new Error(`Failed to fetch access list: ${error.message}`);
    }

    // Get all organizations from Clerk
    const clerk = await clerkClient();
    const clerkOrganizations = await clerk.organizations.getOrganizationList({
      limit: 100,
    });

    // Transform Clerk organizations to match our format
    const organizations = clerkOrganizations.data.map(org => ({
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
    const workflowId = parseInt(workflowIdParam);
    if (isNaN(workflowId)) {
      return NextResponse.json({ success: false, error: 'Invalid workflow ID' }, { status: 400 });
    }

    const { isMediarOrg } = await getEffectiveOrgId();

    // Check if user has @mediar.ai email
    const user = await currentUser();
    const hasMediarEmail = user?.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    // Only Mediar org or @mediar.ai users can update organization access
    if (!isMediarOrg && !hasMediarEmail) {
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, remove all existing access for this workflow
    const { error: deleteError } = await supabase
      .from('workflow_organization_access')
      .delete()
      .eq('workflow_id', workflowId);

    if (deleteError) {
      throw new Error(`Failed to remove existing access: ${deleteError.message}`);
    }

    // Ensure Mediar orgs are always included
    const requiredOrgs = [...MEDIAR_ORG_IDS];
    const allOrgIds = [...new Set([...requiredOrgs, ...organizationIds])];

    // Add new access entries
    if (allOrgIds.length > 0) {
      const accessEntries = allOrgIds.map(orgId => ({
        workflow_id: workflowId,
        organization_id: orgId,
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