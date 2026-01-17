import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { inngest } from '@/lib/inngest/client';
import { generatePoolVmName } from '@/lib/config/warm-pool';

/**
 * POST /api/admin/warm-pool/provision
 * Manually trigger provisioning of a new pool VM
 */
export async function POST() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const poolVmName = generatePoolVmName();

    await inngest.send({
      name: 'pool/provision.requested',
      data: { poolVmName },
    });

    return NextResponse.json({
      success: true,
      message: `Triggered provisioning for pool VM: ${poolVmName}`,
      poolVmName,
    });
  } catch (error) {
    console.error('[Warm Pool Provision API] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to trigger pool provisioning', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/warm-pool/provision
 * Get pool status
 */
export async function GET() {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Count available pool VMs
  const { count: availableCount } = await supabase
    .from('remote_machines')
    .select('id', { count: 'exact', head: true })
    .contains('tags', ['pool:warm', 'pool_status:available'])
    .eq('status', 'inactive');

  // Count total pool VMs
  const { count: totalCount } = await supabase
    .from('remote_machines')
    .select('id', { count: 'exact', head: true })
    .contains('tags', ['pool:warm']);

  // Get all pool VMs
  const { data: poolVms } = await supabase
    .from('remote_machines')
    .select('id, name, status, tags, azure_resource_id, mcp_endpoint')
    .contains('tags', ['pool:warm']);

  return NextResponse.json({
    availableCount: availableCount || 0,
    totalCount: totalCount || 0,
    targetSize: 1,
    poolVms: poolVms || [],
  });
}
