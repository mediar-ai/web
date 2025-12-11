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
 * GET /api/user/machines/[machineId]
 * Get details of a specific machine accessible to the current user
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { userId, orgId } = await auth();
  const { machineId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  const { data: machine, error } = await supabase
    .from('remote_machines')
    .select('*')
    .eq('id', parseInt(machineId))
    .single();

  if (error || !machine) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  // Check access
  if (!canAccessMachine(machine, userId, orgId || null)) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  return NextResponse.json({ machine });
}

/**
 * DELETE /api/user/machines/[machineId]
 * Delete a machine (must be creator or org member)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { userId, orgId } = await auth();
  const { machineId } = await params;

  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // First fetch machine
  const { data: machine, error: fetchError } = await supabase
    .from('remote_machines')
    .select('id, name, terraform_key, azure_resource_id, owner_user_id, owner_org_id')
    .eq('id', parseInt(machineId))
    .single();

  if (fetchError || !machine) {
    return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
  }

  // Check access
  if (!canAccessMachine(machine, userId, orgId || null)) {
    return NextResponse.json({ error: 'You do not have access to this machine' }, { status: 403 });
  }

  // Delete from database first
  const { error: deleteError } = await supabase
    .from('remote_machines')
    .delete()
    .eq('id', parseInt(machineId));

  if (deleteError) {
    console.error('[User Machines API] Failed to delete machine:', deleteError);
    return NextResponse.json({ error: 'Failed to delete machine' }, { status: 500 });
  }

  // Trigger Azure resource cleanup via Inngest (async - don't wait for it)
  try {
    await inngest.send({
      name: 'vm/delete.requested',
      data: {
        machineId: parseInt(machineId),
        azureResourceId: machine.azure_resource_id,
      },
    });
  } catch (err) {
    // Log but don't fail - the DB record is already deleted
    console.error('[User Machines API] Failed to queue Azure cleanup:', err);
  }

  console.log(`[User Machines API] Machine ${machineId} (${machine.name}) deleted by user ${userId}`);

  return NextResponse.json({
    success: true,
    message: `Machine ${machine.name} has been deleted`,
  });
}
