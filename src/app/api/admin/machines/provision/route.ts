import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import {
  provisionVm,
  getEstimatedMonthlyCost,
  getAvailableVmSizes,
  getAvailableRegions,
} from '@/lib/azure/vm-provisioning';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

// Default Mediar organization ID for new VMs
const DEFAULT_ORG_ID = MEDIAR_ORG_IDS[0];

/**
 * GET /api/admin/machines/provision
 * Get provisioning options (VM sizes, regions, cost estimates)
 */
export async function GET() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is a Mediar admin
    const isMediarAdmin = user.emailAddresses?.some(email =>
      email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    );

    if (!isMediarAdmin) {
      return NextResponse.json(
        { success: false, error: 'Only Mediar admins can provision VMs' },
        { status: 403 }
      );
    }

    // Get all organizations from Clerk (paginated)
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
      hasMore = clerkOrganizations.data.length === limit;
      offset += limit;
    }

    // Transform Clerk organizations
    const organizations = allOrganizations.map(org => ({
      id: org.id,
      name: org.name,
    }));

    return NextResponse.json({
      success: true,
      options: {
        vmSizes: getAvailableVmSizes(),
        regions: getAvailableRegions(),
        defaultVmSize: 'Standard_D4s_v3',
        defaultRegion: 'eastus',
        defaultOrganizationId: DEFAULT_ORG_ID,
      },
      organizations,
      costEstimate: getEstimatedMonthlyCost('Standard_D4s_v3'),
    });
  } catch (error) {
    console.error('[Provision API] GET failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get provisioning options',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/machines/provision
 * Provision a new VM
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is a Mediar admin
    const isMediarAdmin = user.emailAddresses?.some(email =>
      email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    );

    if (!isMediarAdmin) {
      return NextResponse.json(
        { success: false, error: 'Only Mediar admins can provision VMs' },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Validate required fields - only name is required now
    if (!body.name) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field: name',
        },
        { status: 400 }
      );
    }

    // Validate name format
    if (!/^[a-zA-Z0-9-]+$/.test(body.name)) {
      return NextResponse.json(
        {
          success: false,
          error: 'VM name must contain only letters, numbers, and hyphens',
        },
        { status: 400 }
      );
    }

    // Use organization name as customer if provided, otherwise use 'mediar'
    let customerName = 'mediar';
    if (body.organizationId) {
      try {
        const clerk = await clerkClient();
        const org = await clerk.organizations.getOrganization({ organizationId: body.organizationId });
        customerName = org.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      } catch {
        // Use default if org lookup fails
      }
    }

    console.log(`[Provision API] Starting VM provision: ${body.name} for ${customerName}`);

    // Get cost estimate for confirmation
    const costEstimate = getEstimatedMonthlyCost(body.vmSize || 'Standard_D4s_v3');

    // Provision the VM
    const result = await provisionVm({
      name: body.name,
      customer: customerName,
      organizationId: body.organizationId || DEFAULT_ORG_ID,
      location: body.location,
      vmSize: body.vmSize,
    });

    if (!result.success) {
      console.error(`[Provision API] VM provision failed: ${result.error}`);
      return NextResponse.json(
        {
          success: false,
          error: result.error,
          details: result.details,
        },
        { status: 500 }
      );
    }

    // Register the VM in Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`[Provision API] Registering VM in Supabase: ${result.vmId}`);

    const { data: machine, error: dbError } = await supabase.rpc(
      'upsert_remote_machine_by_azure_id',
      {
        p_azure_resource_id: result.vmId,
        p_name: body.name,
        p_mcp_endpoint: result.mcpEndpoint,
        p_terraform_key: `dashboard-${body.name}`,
      }
    );

    if (dbError) {
      console.error('[Provision API] Failed to register in Supabase:', dbError);
      // VM was created but registration failed - return partial success
      return NextResponse.json({
        success: true,
        warning: 'VM created but database registration failed. Manual registration may be required.',
        machine: {
          azureResourceId: result.vmId,
          publicIp: result.publicIp,
          mcpEndpoint: result.mcpEndpoint,
          details: result.details,
        },
        dbError: dbError.message,
      });
    }

    const machineId = Array.isArray(machine) ? machine[0]?.id : machine?.id;

    // Grant organization access if specified
    const targetOrgId = body.organizationId || DEFAULT_ORG_ID;
    if (machineId && targetOrgId) {
      const { error: accessError } = await supabase.from('organization_machines').upsert(
        {
          organization_id: targetOrgId,
          machine_id: machineId,
        },
        { onConflict: 'organization_id,machine_id' }
      );

      if (accessError) {
        console.warn('[Provision API] Failed to grant org access:', accessError);
      } else {
        console.log(`[Provision API] Granted access to org ${targetOrgId}`);
      }
    }

    console.log(`[Provision API] VM provisioned successfully: ${result.vmId}`);

    return NextResponse.json({
      success: true,
      machine: {
        id: machineId,
        name: body.name,
        azureResourceId: result.vmId,
        publicIp: result.publicIp,
        mcpEndpoint: result.mcpEndpoint,
        resourceGroup: result.details?.resourceGroup,
        location: result.details?.location,
        vmSize: result.details?.vmSize,
      },
      estimatedCost: {
        monthly: costEstimate.monthly,
        currency: 'USD',
        breakdown: costEstimate.breakdown,
      },
      message: `VM ${body.name} provisioned successfully. It will be ready in 10-15 minutes.`,
    });
  } catch (error) {
    console.error('[Provision API] POST failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to provision VM',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
