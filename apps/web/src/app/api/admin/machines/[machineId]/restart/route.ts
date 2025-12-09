import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { restartVm, isAzureConfigured } from '@/lib/azure';

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
  // Check authentication (optional - admin routes may have different auth)
  const { userId } = await auth();

  if (!supabase) {
    return NextResponse.json(
      { error: 'Supabase client not initialized' },
      { status: 500 }
    );
  }

  if (!isAzureConfigured()) {
    return NextResponse.json(
      { error: 'Azure is not configured. Set AZURE_SUBSCRIPTION_ID.' },
      { status: 500 }
    );
  }

  try {
    const { machineId: id } = await params;
    const machineId = parseInt(id);

    // Fetch machine details
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

    // Restart the VM using the new Azure service
    const result = await restartVm(machine.azure_resource_id);

    // Record operation in database
    await supabase.from('machine_operations').insert({
      machine_id: machineId,
      operation_type: 'restart',
      operation_id: result.operationId,
      status: result.success ? 'running' : 'failed',
      initiated_by: userId || 'admin',
      error_message: result.error,
      details: {
        vmName: result.vmName,
        resourceGroup: result.resourceGroup,
      },
    });

    // Update machine status and power state
    if (result.success) {
      await supabase
        .from('remote_machines')
        .update({
          status: 'restarting',
          power_state: 'starting',
          power_state_updated_at: new Date().toISOString(),
          update_status: null,
          update_error: null,
        })
        .eq('id', machineId);
    }

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || 'Restart failed',
          operationId: result.operationId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      operationId: result.operationId,
      vmName: result.vmName,
      resourceGroup: result.resourceGroup,
    });
  } catch (error: unknown) {
    console.error('[Restart VM] Error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Restart failed';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
