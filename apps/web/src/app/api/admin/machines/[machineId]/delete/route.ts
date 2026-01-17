import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { deleteVmResources, isAzureConfigured, parseAzureVmResourceId } from '@/lib/azure';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

/**
 * DELETE /api/admin/machines/[machineId]/delete
 * Deletes a VM and all its associated Azure resources, then removes from database
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { userId } = await auth();
  const user = await currentUser();

  if (!userId || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if user is a Mediar admin
  const isMediarAdmin = user.emailAddresses?.some(email =>
    email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  );

  if (!isMediarAdmin) {
    return NextResponse.json(
      { error: 'Only Mediar admins can delete VMs' },
      { status: 403 }
    );
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

    let azureDeleted = false;
    let resourceGroup: string | null = null;

    // Try to determine resource group from azure_resource_id or machine name
    if (machine.azure_resource_id) {
      try {
        const parsed = parseAzureVmResourceId(machine.azure_resource_id);
        resourceGroup = parsed.resourceGroup;
      } catch (parseError) {
        console.error('[Delete VM] Failed to parse Azure Resource ID:', parseError);
      }
    }

    // Fallback: derive from machine name pattern (mcp-{customer}-{name} -> mcp-{customer}-{name}-rg)
    if (!resourceGroup && machine.name && machine.name.startsWith('mcp-')) {
      resourceGroup = `${machine.name}-rg`;
      console.log(`[Delete VM] Derived resource group from machine name: ${resourceGroup}`);
    }

    // Delete the resource group if we found one
    if (resourceGroup) {
      console.log(`[Delete VM] Deleting resource group: ${resourceGroup}`);
      const result = await deleteVmResources(resourceGroup);

      if (!result.success) {
        console.error(`[Delete VM] Azure deletion failed: ${result.error}`);
        // Continue to delete from database anyway
      } else {
        azureDeleted = true;
      }
    } else {
      console.warn(`[Delete VM] No resource group found for machine ${machineId} (${machine.name})`);
    }

    // Record operation in database
    await supabase.from('machine_operations').insert({
      machine_id: machineId,
      operation_type: 'delete',
      status: azureDeleted ? 'completed' : 'partial',
      initiated_by: userId,
      details: {
        machineName: machine.name,
        resourceGroup,
        azureDeleted,
      },
    });

    // Delete organization_machines associations
    await supabase
      .from('organization_machines')
      .delete()
      .eq('machine_id', machineId);

    // Delete from remote_machines table
    const { error: deleteError } = await supabase
      .from('remote_machines')
      .delete()
      .eq('id', machineId);

    if (deleteError) {
      console.error('[Delete VM] Database deletion failed:', deleteError);
      return NextResponse.json(
        {
          error: 'Failed to delete machine from database',
          details: deleteError.message,
          azureDeleted,
        },
        { status: 500 }
      );
    }

    console.log(`[Delete VM] Successfully deleted machine ${machineId} (${machine.name})`);

    return NextResponse.json({
      success: true,
      message: azureDeleted
        ? `VM ${machine.name} and all Azure resources deleted successfully`
        : `Machine ${machine.name} removed from database (Azure resources may need manual cleanup)`,
      azureDeleted,
      resourceGroup,
    });
  } catch (error: unknown) {
    console.error('[Delete VM] Error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Delete failed';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
