import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { getVmPublicIp } from '@/lib/azure/vm-operations';

/**
 * POST /api/admin/machines/[machineId]/sync
 * Sync machine endpoints from Azure (fetch public IP and update endpoints)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { machineId } = await params;

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
      { success: false, error: 'Only Mediar admins can sync machines' },
      { status: 403 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { success: false, error: 'Supabase not configured' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Get the machine from DB
    const { data: machine, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (fetchError || !machine) {
      return NextResponse.json(
        { success: false, error: 'Machine not found' },
        { status: 404 }
      );
    }

    if (!machine.azure_resource_id) {
      return NextResponse.json(
        { success: false, error: 'Machine has no Azure Resource ID' },
        { status: 400 }
      );
    }

    console.log(`[Sync] Fetching public IP for machine ${machine.name} (${machine.azure_resource_id})`);

    // Get public IP from Azure
    const publicIp = await getVmPublicIp(machine.azure_resource_id);

    if (!publicIp) {
      return NextResponse.json(
        { success: false, error: 'Could not fetch public IP from Azure' },
        { status: 500 }
      );
    }

    // Update the machine with the new endpoints
    const { error: updateError } = await supabase
      .from('remote_machines')
      .update({
        mcp_endpoint: `http://${publicIp}:8080/mcp`,
        health_endpoint: `http://${publicIp}:8080/health`,
        management_endpoint: `http://${publicIp}:8080/management`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', machineId);

    if (updateError) {
      console.error('[Sync] Failed to update machine:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update machine endpoints' },
        { status: 500 }
      );
    }

    console.log(`[Sync] Updated machine ${machine.name} with IP ${publicIp}`);

    return NextResponse.json({
      success: true,
      publicIp,
      endpoints: {
        mcp_endpoint: `http://${publicIp}:8080/mcp`,
        health_endpoint: `http://${publicIp}:8080/health`,
        management_endpoint: `http://${publicIp}:8080/management`,
      },
      message: `Synced endpoints for ${machine.name}`,
    });
  } catch (error) {
    console.error('[Sync] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync machine',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
