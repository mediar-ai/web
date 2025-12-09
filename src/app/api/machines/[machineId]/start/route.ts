import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { startVm, isAzureConfigured, createAuditContext, initTelemetry } from '@mediar/infra';

// Initialize telemetry on first import
initTelemetry({ serviceName: 'mediar-web-app' });

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
  // Check authentication
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    // Start the VM
    const result = await startVm(machine.azure_resource_id, createAuditContext(userId, 'api'));

    // Record operation in database
    await supabase.from('machine_operations').insert({
      machine_id: machineId,
      operation_type: 'start',
      operation_id: result.operationId,
      status: result.success ? 'running' : 'failed',
      initiated_by: userId,
      error_message: result.error,
      details: {
        vmName: result.vmName,
        resourceGroup: result.resourceGroup,
      },
    });

    // Update machine power state
    if (result.success) {
      await supabase
        .from('remote_machines')
        .update({
          power_state: 'starting',
          power_state_updated_at: new Date().toISOString(),
        })
        .eq('id', machineId);
    }

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || 'Start failed',
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
    console.error('[Start VM] Error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Start failed';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
