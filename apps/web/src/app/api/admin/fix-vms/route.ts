import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Working VM IP loaded from environment variable - required to prevent accidental data corruption
function getWorkingVmIp(): string {
  const ip = process.env.WORKING_VM_IP;
  if (!ip) {
    throw new Error('WORKING_VM_IP environment variable is required for fix-vms endpoint');
  }
  return ip;
}

export async function POST() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get all remote machines
    const { data: machines, error: fetchError } = await supabase
      .from('remote_machines')
      .select('*')
      .order('id', { ascending: true });

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const WORKING_VM_IP = getWorkingVmIp();
    const updates = [];

    // Update all machines to point to working VM
    for (const machine of machines || []) {
      const { data: _data, error } = await supabase
        .from('remote_machines')
        .update({
          ip_address: WORKING_VM_IP,
          mcp_endpoint: `http://${WORKING_VM_IP}:8080/mcp`,
          health_endpoint: `http://${WORKING_VM_IP}:8080/health`,
          status: 'active',
          health_status: 'healthy'
        })
        .eq('id', machine.id)
        .select();

      if (error) {
        updates.push({ id: machine.id, name: machine.name, success: false, error: error.message });
      } else {
        updates.push({ id: machine.id, name: machine.name, success: true });
      }
    }

    return NextResponse.json({
      message: 'Updated all remote machines',
      workingVM: WORKING_VM_IP,
      updates
    });

  } catch (error) {
    console.error('Error updating VMs:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
