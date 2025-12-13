import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import {
  getEstimatedMonthlyCost,
  getAvailableVmSizes,
  getAvailableRegions,
} from '@/lib/azure/vm-provisioning';
import { inngest } from '@/lib/inngest';
import { VM_SIZES, getVmLaunchCost } from '@/lib/credits';

/**
 * GET /api/vm/provision
 * Get provisioning options (VM sizes, regions, cost estimates) for users
 */
export async function GET() {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's current credit balance
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: credits } = await supabase
      .rpc('get_user_credits', { p_user_id: userId });

    const balance = credits?.[0]?.balance || 0;

    return NextResponse.json({
      success: true,
      options: {
        vmSizes: VM_SIZES.map(size => ({
          ...size,
          canAfford: balance >= size.launchCost,
        })),
        regions: getAvailableRegions(),
        defaultVmSize: 'Standard_D4s_v3',
        defaultRegion: 'eastus',
      },
      userCredits: {
        balance,
        lifetime_earned: credits?.[0]?.lifetime_earned || 0,
        lifetime_spent: credits?.[0]?.lifetime_spent || 0,
      },
      costEstimate: getEstimatedMonthlyCost('Standard_D4s_v3'),
    });
  } catch (error) {
    console.error('[VM Provision API] GET failed:', error);
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
}

// Get client IP from request headers (works with Vercel, Cloudflare, etc.)
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  // Vercel-specific
  const vercelIp = request.headers.get('x-vercel-forwarded-for');
  if (vercelIp) {
    return vercelIp.split(',')[0].trim();
  }
  return 'unknown';
}

/**
 * POST /api/vm/provision
 * Provision a new VM for the user - deducts credits and starts provisioning
 */
export async function POST(request: NextRequest) {
  const { userId, orgId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const email = user.emailAddresses?.[0]?.emailAddress;
  const clientIp = getClientIp(request);

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

  const vmSize = body.vmSize || 'Standard_D4s_v3';
  const launchCost = getVmLaunchCost(vmSize);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error' },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Security: Max 3 VMs per user to prevent abuse
  const MAX_VMS_PER_USER = 3;
  const { count: vmCount } = await supabase
    .from('remote_machines')
    .select('id', { count: 'exact', head: true })
    .eq('owner_user_id', userId)
    .not('status', 'in', '("deleted","failed")');

  if (vmCount !== null && vmCount >= MAX_VMS_PER_USER) {
    console.warn(`[VM Provision API] User ${userId} hit VM limit: ${vmCount}/${MAX_VMS_PER_USER}`);
    return NextResponse.json(
      {
        success: false,
        error: `Maximum ${MAX_VMS_PER_USER} sandboxes per user. Please delete existing sandboxes first.`,
        currentCount: vmCount,
        maxAllowed: MAX_VMS_PER_USER,
      },
      { status: 400 }
    );
  }

  // Security: Rate limit - max 1 VM creation per hour to prevent rapid abuse
  const ONE_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentVm } = await supabase
    .from('remote_machines')
    .select('created_at, name')
    .eq('owner_user_id', userId)
    .gte('created_at', ONE_HOUR_AGO)
    .order('created_at', { ascending: false })
    .limit(1);

  if (recentVm && recentVm.length > 0) {
    const lastCreated = new Date(recentVm[0].created_at);
    const waitMinutes = Math.ceil((lastCreated.getTime() + 60 * 60 * 1000 - Date.now()) / 60000);
    console.warn(`[VM Provision API] User ${userId} rate limited. Last VM: ${recentVm[0].name}`);
    return NextResponse.json(
      {
        success: false,
        error: `Rate limit: please wait ${waitMinutes} minutes before creating another sandbox.`,
        retryAfterMinutes: waitMinutes,
      },
      { status: 429 }
    );
  }

  // Security: IP-based rate limit - max 5 VMs per IP per 24 hours to prevent multi-account abuse
  const MAX_VMS_PER_IP_PER_DAY = 5;
  const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  if (clientIp && clientIp !== 'unknown') {
    const ipTag = `ip:${clientIp}`;
    const { count: ipVmCount } = await supabase
      .from('remote_machines')
      .select('id', { count: 'exact', head: true })
      .contains('tags', [ipTag])
      .gte('created_at', TWENTY_FOUR_HOURS_AGO);

    if (ipVmCount !== null && ipVmCount >= MAX_VMS_PER_IP_PER_DAY) {
      console.warn(`[VM Provision API] IP ${clientIp} hit daily limit: ${ipVmCount}/${MAX_VMS_PER_IP_PER_DAY} (user: ${userId})`);
      return NextResponse.json(
        {
          success: false,
          error: `Too many sandboxes created from this network. Please try again tomorrow.`,
          limit: MAX_VMS_PER_IP_PER_DAY,
        },
        { status: 429 }
      );
    }
  }

  try {
    // Check and deduct credits atomically
    const { data: deductResult, error: deductError } = await supabase.rpc('deduct_credits', {
      p_user_id: userId,
      p_amount: launchCost,
      p_type: 'vm_launch',
      p_description: `Launched VM: ${body.name} (${vmSize})`,
      p_reference_id: body.name,
    });

    if (deductError) {
      console.error('[VM Provision API] Failed to deduct credits:', deductError);
      return NextResponse.json(
        { success: false, error: 'Failed to process credits' },
        { status: 500 }
      );
    }

    const result = deductResult?.[0];
    if (!result?.success) {
      return NextResponse.json(
        {
          success: false,
          error: result?.error_message || 'Insufficient credits',
          required: launchCost,
          balance: result?.new_balance || 0,
        },
        { status: 400 }
      );
    }

    console.log(`[VM Provision API] Credits deducted: ${launchCost}, new balance: ${result.new_balance}`);

    // Generate customer name from user info
    const customerName = (email?.split('@')[0] || userId)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 20);

    const vmName = `${customerName}-${body.name}`.slice(0, 40);

    console.log(`[VM Provision API] Creating provisioning record for: ${vmName}`);

    const costEstimate = getEstimatedMonthlyCost(vmSize);

    // Create DB record with status="provisioning"
    const placeholderIp = 'provisioning.local';
    const { data: machine, error: dbError } = await supabase
      .from('remote_machines')
      .insert({
        name: vmName,
        mcp_endpoint: `http://${placeholderIp}:8080/mcp`,
        health_endpoint: `http://${placeholderIp}:8080/health`,
        management_endpoint: `http://${placeholderIp}:8080/management`,
        terraform_key: `user-${userId}-${body.name}`,
        tags: [`terraform:user-${userId}-${body.name}`, `user:${userId}`, `vm:${body.name}`, `ip:${clientIp}`],
        status: 'inactive',
        health_status: 'unknown',
        machine_type: 'windows_vm',
        region: body.location || 'eastus',
        is_global: false,
        owner_user_id: userId, // Creator of the VM
        owner_org_id: orgId || null, // Org that owns this VM (all org members can access)
        provisioned_at: new Date().toISOString(),
        provisioning_step: JSON.stringify({
          step: 'queued',
          status: 'in_progress',
          message: 'Waiting for provisioning to start...',
          timestamp: new Date().toISOString(),
        }),
      })
      .select()
      .single();

    if (dbError) {
      console.error('[VM Provision API] Failed to create provisioning record:', dbError);
      // Refund credits on failure
      await supabase.rpc('add_credits', {
        p_user_id: userId,
        p_amount: launchCost,
        p_type: 'refund',
        p_description: `Refund for failed VM provision: ${body.name}`,
        p_reference_id: body.name,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to create provisioning record', details: dbError.message },
        { status: 500 }
      );
    }

    const machineId = machine?.id;

    console.log(`[VM Provision API] Created provisioning record with ID: ${machineId}`);

    // Send event to Inngest to trigger durable provisioning function
    console.log(`[VM Provision API] Sending vm/provision.requested event to Inngest for machine ${machineId}`);
    await inngest.send({
      name: 'vm/provision.requested',
      data: {
        machineId,
        vmName,
        customer: customerName,
        location: body.location || 'eastus',
        vmSize,
        userId,
      },
    });
    console.log(`[VM Provision API] Inngest event sent successfully`);

    // Return immediately with the machine ID (UI will poll for status)
    return NextResponse.json({
      success: true,
      machine: {
        id: machineId,
        name: vmName,
        status: 'provisioning',
      },
      creditsDeducted: launchCost,
      newBalance: result.new_balance,
      estimatedCost: {
        monthly: costEstimate.monthly,
        currency: 'USD',
        breakdown: costEstimate.breakdown,
      },
      message: `VM ${vmName} is being provisioned. This will take 5-10 minutes.`,
    });
  } catch (error) {
    console.error('[VM Provision API] POST failed:', error);
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
