import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
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

interface ProvisionBody {
  name: string;
  vmSize?: string;
  location?: string;
  organizationId?: string;
}

/**
 * POST /api/admin/machines/provision
 * Provision a new VM - starts provisioning and returns immediately
 *
 * Note: VM provisioning takes 5-10 minutes. We start the process and return
 * immediately. The VM will appear in the machine list once provisioning completes.
 * SSE streaming doesn't work on Vercel due to serverless function timeouts.
 */
export async function POST(request: NextRequest) {
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

  const body: ProvisionBody = await request.json();

  // Validate required fields
  if (!body.name) {
    return NextResponse.json(
      { success: false, error: 'Missing required field: name' },
      { status: 400 }
    );
  }

  if (!/^[a-zA-Z0-9-]+$/.test(body.name)) {
    return NextResponse.json(
      { success: false, error: 'VM name must contain only letters, numbers, and hyphens' },
      { status: 400 }
    );
  }

  return handleProvision(body);
}

/**
 * Handle VM provision - creates DB record immediately, runs Azure provisioning in background
 */
async function handleProvision(body: ProvisionBody): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { success: false, error: 'Supabase environment variables are not set' },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get customer name from org
    let customerName = 'mediar';
    if (body.organizationId) {
      try {
        const clerk = await clerkClient();
        const org = await clerk.organizations.getOrganization({ organizationId: body.organizationId });
        customerName = org.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
      } catch {
        // Use default
      }
    }

    console.log(`[Provision API] Creating provisioning record for: ${body.name}`);

    const costEstimate = getEstimatedMonthlyCost(body.vmSize || 'Standard_D4s_v3');

    // Step 1: Create DB record FIRST with status="provisioning"
    // Use placeholders for endpoint fields (NOT NULL constraints) - will be updated after Azure provisioning
    const placeholderIp = 'provisioning.local';
    const { data: machine, error: dbError } = await supabase
      .from('remote_machines')
      .insert({
        name: body.name,
        mcp_endpoint: `http://${placeholderIp}:8080/mcp`,
        health_endpoint: `http://${placeholderIp}:8080/health`,
        management_endpoint: `http://${placeholderIp}:8080/management`,
        terraform_key: `dashboard-${body.name}`,
        status: 'inactive', // Starts as inactive, will be set to 'active' when provisioning completes
        health_status: 'unknown',
        machine_type: 'windows_vm',
        region: body.location || 'eastus',
        is_global: false,
        provisioned_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (dbError) {
      console.error('[Provision API] Failed to create provisioning record:', dbError);
      return NextResponse.json(
        { success: false, error: 'Failed to create provisioning record', details: dbError.message },
        { status: 500 }
      );
    }

    const machineId = machine?.id;

    // Grant organization access
    const targetOrgId = body.organizationId || DEFAULT_ORG_ID;
    if (machineId && targetOrgId) {
      await supabase.from('organization_machines').upsert(
        { organization_id: targetOrgId, machine_id: machineId },
        { onConflict: 'organization_id,machine_id' }
      );
    }

    console.log(`[Provision API] Created provisioning record with ID: ${machineId}`);

    // Step 2: Schedule Azure provisioning to run after response using Next.js after()
    after(async () => {
      console.log(`[Provision API] Starting background Azure provisioning for: ${body.name}`);

      try {
        const result = await provisionVm({
          name: body.name,
          customer: customerName,
          organizationId: body.organizationId || DEFAULT_ORG_ID,
          location: body.location,
          vmSize: body.vmSize,
        });

        if (result.success) {
          // Update DB record with Azure details
          const { error: updateError } = await supabase
            .from('remote_machines')
            .update({
              mcp_endpoint: result.mcpEndpoint,
              health_endpoint: `http://${result.publicIp}:8080/health`,
              management_endpoint: `http://${result.publicIp}:8080/management`,
              azure_resource_id: result.vmId,
              status: 'active',
              updated_at: new Date().toISOString(),
            })
            .eq('id', machineId);

          if (updateError) {
            console.error(`[Provision API] Failed to update machine ${machineId}:`, updateError);
          } else {
            console.log(`[Provision API] VM ${body.name} provisioned successfully: ${result.vmId}`);
          }
        } else {
          // Update DB record with failure (keep status 'inactive', mark as unhealthy)
          await supabase
            .from('remote_machines')
            .update({
              status: 'inactive',
              health_status: 'unhealthy',
              updated_at: new Date().toISOString(),
            })
            .eq('id', machineId);

          console.error(`[Provision API] VM provision failed: ${result.error}`);
        }
      } catch (error) {
        console.error(`[Provision API] Background provisioning error:`, error);
        // Update DB record with failure (keep status 'inactive', mark as unhealthy)
        await supabase
          .from('remote_machines')
          .update({
            status: 'inactive',
            health_status: 'unhealthy',
            updated_at: new Date().toISOString(),
          })
          .eq('id', machineId);
      }
    });

    // Step 3: Return immediately with the machine ID (UI will poll for status)
    return NextResponse.json({
      success: true,
      machine: {
        id: machineId,
        name: body.name,
        status: 'provisioning',
      },
      estimatedCost: {
        monthly: costEstimate.monthly,
        currency: 'USD',
        breakdown: costEstimate.breakdown,
      },
      message: `VM ${body.name} is being provisioned. This will take 5-10 minutes.`,
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
