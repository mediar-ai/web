import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  getEstimatedMonthlyCost,
  getAvailableRegions,
} from '@/lib/azure/vm-provisioning';
import { inngest } from '@/lib/inngest';
import { VM_SIZES, getVmLaunchCost } from '@/lib/credits';
import { randomUUID } from 'crypto';
import {
  WARM_POOL_CONFIG,
  updateTagsToClaimingStatus,
} from '@/lib/config/warm-pool';

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
  isTrial?: boolean;
}

// Trial sandbox configuration
const TRIAL_CONFIG = {
  vmSize: 'Standard_D2s_v3',
  autoStopMinutes: 30,
  autoDeleteDays: 1,
};

/**
 * Try to claim a VM from the warm pool for trial users
 * Returns the pool VM details if successful, null otherwise
 */
async function claimFromWarmPool(
  userId: string,
  orgId: string | null,
  requestId: string,
  vmName: string,
  supabase: SupabaseClient
): Promise<{
  machineId: number;
  name: string;
  mcpEndpoint: string;
} | null> {
  try {
    // Find and lock an available pool VM using FOR UPDATE SKIP LOCKED
    // This prevents race conditions when multiple users try to claim simultaneously
    const { data: poolVm, error } = await supabase
      .from('remote_machines')
      .select('id, name, tags, mcp_endpoint')
      .contains('tags', [WARM_POOL_CONFIG.tags.poolWarm, WARM_POOL_CONFIG.tags.poolStatusAvailable])
      .eq('status', 'inactive')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error || !poolVm) {
      console.log('[VM Provision API] No available pool VMs');
      return null;
    }

    // Update the VM to claiming status atomically
    const updatedTags = updateTagsToClaimingStatus(poolVm.tags || [], userId, requestId);

    const { error: updateError } = await supabase
      .from('remote_machines')
      .update({
        tags: updatedTags,
        status: 'claiming',
        provisioning_step: JSON.stringify({
          step: 'claiming',
          status: 'in_progress',
          message: 'Claiming sandbox from pool...',
          timestamp: new Date().toISOString(),
        }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', poolVm.id)
      .contains('tags', [WARM_POOL_CONFIG.tags.poolStatusAvailable]); // Double-check it's still available

    if (updateError) {
      console.error('[VM Provision API] Failed to update pool VM to claiming:', updateError);
      return null;
    }

    console.log(`[VM Provision API] Claimed pool VM ${poolVm.id} for user ${userId}`);

    // Send claim event to Inngest to start the VM
    await inngest.send({
      name: 'pool/claim.requested',
      data: {
        machineId: poolVm.id,
        userId,
        orgId,
        requestId,
        vmName,
      },
    });

    // Trigger background replenishment
    await inngest.send({
      name: 'pool/replenish.requested',
      data: {},
    });

    return {
      machineId: poolVm.id,
      name: poolVm.name,
      mcpEndpoint: poolVm.mcp_endpoint,
    };
  } catch (err) {
    console.error('[VM Provision API] Error claiming from warm pool:', err);
    return null;
  }
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
 * Provision a new VM for the user - validates, deducts credits, sends to Inngest
 *
 * INNGEST-FIRST APPROACH:
 * - API validates and deducts credits
 * - API sends event to Inngest with requestId
 * - Inngest creates DB record as step 1 (transactional)
 * - If Inngest fails before step 1, no orphan records
 * - If Inngest fails after step 1, cleanup happens in Inngest
 */
export async function POST(request: NextRequest) {
  const { userId, orgId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const email = user.emailAddresses?.[0]?.emailAddress;
  const clientIp = getClientIp(request);

  // Check if user is Mediar team (bypass rate limits)
  const isMediarUser =
    user.organizationMemberships?.some(m => m.organization?.slug === 'mediar') ||
    email === 'louis@mediar.ai' ||
    email === 'matt@mediar.ai' ||
    email?.endsWith('@mediar.ai');

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

  const isTrial = body.isTrial === true;

  // SECURITY: Validate vmSize against allowed sizes to prevent cost attacks
  // Without this check, attacker could request vmSize="Standard_D96as_v5" (96 cores, $10+/hr)
  // and only pay 10 credits (default fallback cost)
  const ALLOWED_VM_SIZE_IDS = VM_SIZES.map(s => s.id) as readonly string[];
  const requestedVmSize = body.vmSize || 'Standard_D4s_v3';

  if (!isTrial && !ALLOWED_VM_SIZE_IDS.includes(requestedVmSize)) {
    return NextResponse.json(
      {
        success: false,
        error: `Invalid VM size: ${requestedVmSize}. Allowed: ${ALLOWED_VM_SIZE_IDS.join(', ')}`
      },
      { status: 400 }
    );
  }

  // Trial sandboxes use fixed small size, otherwise use validated size
  // Cast is safe because we validated above
  const vmSize = isTrial ? TRIAL_CONFIG.vmSize : (requestedVmSize as typeof VM_SIZES[number]['id']);
  // Trial sandboxes are free
  const launchCost = isTrial ? 0 : getVmLaunchCost(vmSize);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { success: false, error: 'Server configuration error' },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Skip rate limits in development (localhost) or for Mediar team
  const skipRateLimits = process.env.NODE_ENV === 'development' ||
    request.headers.get('host')?.includes('localhost') ||
    isMediarUser;

  // Security: Max 3 VMs per user to prevent abuse (skip for Mediar team)
  if (!skipRateLimits) {
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
  }

  // Security: Rate limit - max 1 VM creation per hour to prevent rapid abuse
  // Skip in development
  if (!skipRateLimits) {
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
  }

  // Security: IP-based rate limit - max 5 VMs per IP per 24 hours to prevent multi-account abuse
  // Skip in development or for Mediar team
  if (!skipRateLimits && clientIp && clientIp !== 'unknown') {
    const MAX_VMS_PER_IP_PER_DAY = 5;
    const TWENTY_FOUR_HOURS_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
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

  // Security: Limit trial sandboxes to 1 per user (lifetime) to prevent abuse
  // Trials are free, so without this limit users could create unlimited free VMs
  if (isTrial && !skipRateLimits) {
    const trialTag = 'trial:true';
    const { count: trialCount } = await supabase
      .from('remote_machines')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .contains('tags', [trialTag]);

    if (trialCount !== null && trialCount >= 1) {
      console.warn(`[VM Provision API] User ${userId} already used trial sandbox`);
      return NextResponse.json(
        {
          success: false,
          error: 'You have already used your free trial sandbox. Please purchase credits to create more sandboxes.',
          trialUsed: true,
        },
        { status: 400 }
      );
    }
  }

  // Security: Global sanity limit - max 50 VMs total to prevent runaway costs
  // This catches edge cases where rate limits might be bypassed
  if (!skipRateLimits) {
    const MAX_GLOBAL_VMS = 50;
    const { count: globalVmCount } = await supabase
      .from('remote_machines')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("deleted","failed")');

    if (globalVmCount !== null && globalVmCount >= MAX_GLOBAL_VMS) {
      console.error(`[VM Provision API] CRITICAL: Global VM limit reached: ${globalVmCount}/${MAX_GLOBAL_VMS}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Service is at capacity. Please try again later or contact support.',
        },
        { status: 503 }
      );
    }
  }

  // For trial sandboxes, try to claim from warm pool first (much faster: ~30-60s vs 5-10min)
  if (isTrial) {
    try {
      // Generate request ID early so we can use it for pool claim
      const requestId = randomUUID();

      // Generate VM name for the claimed sandbox
      const customerName = (email?.split('@')[0] || userId)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 20);
      const randomSuffix = Math.random().toString(36).substring(2, 6);
      const vmName = `${customerName}-${body.name}-${randomSuffix}`.slice(0, 40);

      const poolVm = await claimFromWarmPool(userId, orgId || null, requestId, vmName, supabase);

      if (poolVm) {
        // Get current balance for response
        const { data: credits } = await supabase.rpc('get_user_credits', { p_user_id: userId });
        const newBalance = credits?.[0]?.balance || 0;

        console.log(`[VM Provision API] Claimed pool VM ${poolVm.machineId} for trial user ${userId}`);

        const costEstimate = getEstimatedMonthlyCost(vmSize);

        return NextResponse.json({
          success: true,
          requestId,
          machineId: poolVm.machineId,
          vmName,
          isTrial: true,
          fromPool: true, // Indicates this was claimed from warm pool
          creditsDeducted: 0,
          newBalance,
          estimatedCost: {
            monthly: costEstimate.monthly,
            currency: 'USD',
            breakdown: costEstimate.breakdown,
          },
          message: `Trial sandbox is starting! This will be ready in ~30-60 seconds (claimed from warm pool).`,
        });
      }

      // If no pool VM available, fall through to regular provisioning
      console.log('[VM Provision API] No pool VMs available, falling back to regular provisioning');
    } catch (poolError) {
      console.error('[VM Provision API] Error checking warm pool, falling back:', poolError);
      // Fall through to regular provisioning
    }
  }

  try {
    let newBalance = 0;

    // Only deduct credits if not a trial (trial is free)
    if (launchCost > 0) {
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

      newBalance = result.new_balance;
      console.log(`[VM Provision API] Credits deducted: ${launchCost}, new balance: ${newBalance}`);
    } else {
      // For trial, just get current balance
      const { data: credits } = await supabase.rpc('get_user_credits', { p_user_id: userId });
      newBalance = credits?.[0]?.balance || 0;
      console.log(`[VM Provision API] Trial sandbox - no credits deducted. Balance: ${newBalance}`);
    }

    // Generate customer name from user info
    const customerName = (email?.split('@')[0] || userId)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 20);

    // Add random suffix to avoid name collisions
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const vmName = `${customerName}-${body.name}-${randomSuffix}`.slice(0, 40);

    // Generate unique request ID for tracking
    const requestId = randomUUID();

    const costEstimate = getEstimatedMonthlyCost(vmSize);

    console.log(`[VM Provision API] Sending vm/provision.requested event to Inngest (requestId: ${requestId}, trial: ${isTrial})`);

    // INNGEST-FIRST: Send event with all data, Inngest creates DB record as step 1
    await inngest.send({
      name: 'vm/provision.requested',
      data: {
        requestId,
        vmName,
        customer: customerName,
        location: body.location || 'eastus',
        vmSize,
        userId,
        orgId: orgId || null,
        clientIp,
        isTrial,
        trialConfig: isTrial ? TRIAL_CONFIG : null,
        launchCost,
      },
    });

    console.log(`[VM Provision API] Inngest event sent successfully`);

    // Return requestId - UI will poll for status
    return NextResponse.json({
      success: true,
      requestId,
      vmName,
      isTrial,
      creditsDeducted: launchCost,
      newBalance,
      estimatedCost: {
        monthly: costEstimate.monthly,
        currency: 'USD',
        breakdown: costEstimate.breakdown,
      },
      message: isTrial
        ? `Trial sandbox ${vmName} is being provisioned. It will auto-stop after ${TRIAL_CONFIG.autoStopMinutes} minutes of inactivity.`
        : `VM ${vmName} is being provisioned. This will take 5-10 minutes.`,
    });
  } catch (error) {
    console.error('[VM Provision API] POST failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        error: `Failed to provision VM: ${errorMessage}`,
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
