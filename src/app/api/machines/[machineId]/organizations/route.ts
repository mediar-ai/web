import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase environment variables are not set');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// GET /api/machines/[machineId]/organizations - Get all organizations assigned to a machine
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    const { machineId: machineIdStr } = await params;
    const machineId = parseInt(machineIdStr);

    if (isNaN(machineId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid machine ID' },
        { status: 400 }
      );
    }

    // Get machine details
    const { data: machine, error: machineError } = await supabase
      .from('remote_machines')
      .select('id, name, is_global')
      .eq('id', machineId)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { success: false, error: 'Machine not found' },
        { status: 404 }
      );
    }

    // Get organization assignments
    const { data: assignments, error: assignmentsError } = await supabase
      .from('machine_organization_assignments')
      .select('organization_id, assigned_at, assigned_by')
      .eq('machine_id', machineId)
      .order('assigned_at', { ascending: true });

    if (assignmentsError) {
      throw new Error(`Failed to fetch assignments: ${assignmentsError.message}`);
    }

    return NextResponse.json({
      success: true,
      machine: {
        id: machine.id,
        name: machine.name,
        is_global: machine.is_global
      },
      organizations: assignments || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] Error fetching machine organizations:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch machine organizations',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// PUT /api/machines/[machineId]/organizations - Update organization assignments for a machine
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    const { machineId: machineIdStr } = await params;
    const machineId = parseInt(machineIdStr);
    const body = await request.json();

    if (isNaN(machineId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid machine ID' },
        { status: 400 }
      );
    }

    const { organization_ids, is_global } = body;

    if (typeof is_global !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'is_global must be a boolean' },
        { status: 400 }
      );
    }

    if (!Array.isArray(organization_ids)) {
      return NextResponse.json(
        { success: false, error: 'organization_ids must be an array' },
        { status: 400 }
      );
    }

    // Update is_global flag
    const { error: updateError } = await supabase
      .from('remote_machines')
      .update({ is_global })
      .eq('id', machineId);

    if (updateError) {
      throw new Error(`Failed to update machine: ${updateError.message}`);
    }

    // If is_global is true, we can optionally clear assignments
    // But we'll keep them for record-keeping

    // If is_global is false, manage organization assignments
    if (!is_global) {
      // Get current assignments
      const { data: currentAssignments } = await supabase
        .from('machine_organization_assignments')
        .select('organization_id')
        .eq('machine_id', machineId);

      const currentOrgIds = (currentAssignments || []).map(a => a.organization_id);
      const newOrgIds = organization_ids;

      // Delete assignments that are no longer in the list
      const toDelete = currentOrgIds.filter(id => !newOrgIds.includes(id));
      if (toDelete.length > 0) {
        await supabase
          .from('machine_organization_assignments')
          .delete()
          .eq('machine_id', machineId)
          .in('organization_id', toDelete);
      }

      // Add new assignments
      const toAdd = newOrgIds.filter(id => !currentOrgIds.includes(id));
      if (toAdd.length > 0) {
        const newAssignments = toAdd.map(orgId => ({
          machine_id: machineId,
          organization_id: orgId
        }));

        const { error: insertError } = await supabase
          .from('machine_organization_assignments')
          .insert(newAssignments);

        if (insertError) {
          throw new Error(`Failed to insert assignments: ${insertError.message}`);
        }
      }
    }

    // Fetch updated assignments
    const { data: updatedAssignments } = await supabase
      .from('machine_organization_assignments')
      .select('organization_id, assigned_at')
      .eq('machine_id', machineId);

    return NextResponse.json({
      success: true,
      message: 'Machine organization assignments updated',
      restart_required: true,
      restart_message: 'VM restart required for organization filtering to take effect. Please restart the VM or remount the S3 drive.',
      machine_id: machineId,
      is_global,
      organizations: updatedAssignments || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] Error updating machine organizations:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update machine organizations',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
