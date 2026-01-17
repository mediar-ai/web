import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/vm/provision/status?requestId=xxx
 * Poll provisioning status by requestId
 *
 * This endpoint is used after the provision API returns a requestId.
 * The UI polls this endpoint to track provisioning progress until the VM is ready.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const requestId = request.nextUrl.searchParams.get('requestId');
    if (!requestId) {
      return NextResponse.json(
        { success: false, error: 'Missing requestId parameter' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find machine by requestId tag
    const requestTag = `request:${requestId}`;
    const { data: machine, error } = await supabase
      .from('remote_machines')
      .select('id, name, status, health_status, provisioning_step, mcp_endpoint, tags, created_at, updated_at')
      .eq('owner_user_id', userId)
      .contains('tags', [requestTag])
      .single();

    if (error || !machine) {
      // Machine not found could mean:
      // 1. Inngest hasn't created it yet (still pending)
      // 2. Invalid requestId
      // 3. User doesn't own this machine
      return NextResponse.json({
        success: true,
        status: 'pending',
        message: 'Provisioning job is queued, waiting for Inngest to start...',
        requestId,
      });
    }

    // Parse provisioning step
    let provisioningStep = null;
    if (machine.provisioning_step) {
      try {
        provisioningStep = typeof machine.provisioning_step === 'string'
          ? JSON.parse(machine.provisioning_step)
          : machine.provisioning_step;
      } catch {
        provisioningStep = { step: 'unknown', status: 'unknown', message: machine.provisioning_step };
      }
    }

    // Determine overall status
    const isComplete = machine.status === 'active' && provisioningStep?.step === 'done';
    const isFailed = machine.status === 'failed' || provisioningStep?.status === 'failed';
    // Detect pool claims by provisioning step (step=pool_claim) or starting status with pool tags
    const isPoolClaim = provisioningStep?.step === 'pool_claim' ||
      (machine.status === 'starting' && machine.tags?.includes('pool:warm'));

    // Determine status string and message
    let status: 'pending' | 'provisioning' | 'claiming' | 'complete' | 'failed';
    let statusMessage: string | undefined;

    if (isFailed) {
      status = 'failed';
      statusMessage = provisioningStep?.message || 'Provisioning failed';
    } else if (isComplete) {
      status = 'complete';
      statusMessage = 'Sandbox is ready!';
    } else if (isPoolClaim) {
      status = 'claiming';
      statusMessage = provisioningStep?.message || 'Starting your sandbox from pool...';
    } else {
      status = 'provisioning';
      statusMessage = provisioningStep?.message || 'Provisioning in progress...';
    }

    return NextResponse.json({
      success: true,
      status,
      statusMessage,
      requestId,
      machineId: machine.id,
      machine: {
        id: machine.id,
        name: machine.name,
        status: machine.status,
        healthStatus: machine.health_status,
        mcpEndpoint: machine.mcp_endpoint,
        createdAt: machine.created_at,
        updatedAt: machine.updated_at,
      },
      provisioningStep,
    });
  } catch (error) {
    console.error('[VM Provision Status API] GET failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get provisioning status',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
