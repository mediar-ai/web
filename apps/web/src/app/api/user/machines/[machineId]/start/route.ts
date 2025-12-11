import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { inngest } from '@/lib/inngest';

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Server configuration error');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

// Check if user can access machine (owns it or is in the owning org)
function canAccessMachine(machine: { owner_user_id: string | null; owner_org_id: string | null }, userId: string, orgId: string | null): boolean {
  if (machine.owner_user_id === userId) return true;
  if (orgId && machine.owner_org_id === orgId) return true;
  return false;
}

/**
 * POST /api/user/machines/[machineId]/start
 * Start a stopped VM accessible to the current user
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { userId, orgId } = await auth();
  const { machineId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Fetch machine
  const { data: machine, error: fetchError } = await supabase
    .from('remote_machines')
    .select('id, name, terraform_key, owner_user_id, owner_org_id, status')
    .eq('id', parseInt(machineId))
    .single();

  if (fetchError || !machine) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  if (!canAccessMachine(machine, userId, orgId || null)) {
    return NextResponse.json({ error: 'You do not have access to this machine' }, { status: 403 });
  }

  if (machine.status === 'active' || machine.status === 'starting') {
    return NextResponse.json({ error: 'Machine is already running' }, { status: 400 });
  }

  // Update status to starting
  await supabase
    .from('remote_machines')
    .update({ status: 'starting' })
    .eq('id', parseInt(machineId));

  // Send event to Inngest to trigger VM start
  try {
    await inngest.send({
      name: 'vm/start.requested',
      data: {
        machineId: parseInt(machineId),
        vmName: machine.name,
        terraformKey: machine.terraform_key,
        userId,
      },
    });
  } catch (err) {
    console.error('[User Machines API] Failed to send start event:', err);
    // Revert status if we couldn't queue the start
    await supabase
      .from('remote_machines')
      .update({ status: machine.status })
      .eq('id', parseInt(machineId));
    return NextResponse.json({ error: 'Failed to queue start operation' }, { status: 500 });
  }

  console.log(`[User Machines API] Start requested for machine ${machineId} (${machine.name}) by user ${userId}`);

  return NextResponse.json({
    success: true,
    message: `Starting ${machine.name}...`,
  });
}
