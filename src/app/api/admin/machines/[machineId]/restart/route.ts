import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ComputeManagementClient } from '@azure/arm-compute';
import { DefaultAzureCredential } from '@azure/identity';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ machineId: string }> }
) {
  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  try {
    const { machineId: id } = await params;
    const machineId = parseInt(id);

    const { data: machine, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (fetchError || !machine) {
      return NextResponse.json({ error: 'Machine not found' }, { status: 404 });
    }

    if (!machine.azure_resource_id) {
      return NextResponse.json(
        { error: 'Machine does not have Azure Resource ID configured' },
        { status: 400 }
      );
    }

    const parts = machine.azure_resource_id.split('/');
    const subscriptionIndex = parts.indexOf('subscriptions');
    const rgIndex = parts.indexOf('resourceGroups');
    const vmIndex = parts.indexOf('virtualMachines');

    if (subscriptionIndex === -1 || rgIndex === -1 || vmIndex === -1) {
      return NextResponse.json(
        { error: 'Invalid Azure Resource ID format' },
        { status: 400 }
      );
    }

    const subscriptionId = parts[subscriptionIndex + 1];
    const resourceGroup = parts[rgIndex + 1];
    const vmName = parts[vmIndex + 1];

    console.log(`[Restart VM] Restarting ${vmName} in ${resourceGroup}`);

    const credential = new DefaultAzureCredential();
    const computeClient = new ComputeManagementClient(
      credential,
      subscriptionId
    );

    // Update status
    await supabase
      .from('remote_machines')
      .update({
        status: 'restarting',
        update_status: null,
        update_error: null,
      })
      .eq('id', machineId);

    // Restart VM (async - don't wait)
    await computeClient.virtualMachines.beginRestart(resourceGroup, vmName);

    return NextResponse.json({
      success: true,
      message: `Restart initiated for ${machine.name}. VM will be back online in ~2 minutes.`,
      vmName,
      resourceGroup,
    });
  } catch (error: any) {
    console.error('[Restart VM] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Restart failed' },
      { status: 500 }
    );
  }
}
