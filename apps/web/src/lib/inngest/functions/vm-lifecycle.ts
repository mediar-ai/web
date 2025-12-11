import { inngest } from '../client';
import { ComputeManagementClient } from '@azure/arm-compute';
import { ResourceManagementClient } from '@azure/arm-resources';
import { getAzureCredential, getSubscriptionId } from '@/lib/azure/client';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

function getAzureClients() {
  const subscriptionId = getSubscriptionId();
  const credential = getAzureCredential();
  return {
    compute: new ComputeManagementClient(credential, subscriptionId),
    resource: new ResourceManagementClient(credential, subscriptionId),
    subscriptionId,
  };
}

// Parse resource group and VM name from azure_resource_id
function parseAzureResourceId(resourceId: string): { resourceGroup: string; vmName: string } | null {
  // Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines/{vm}
  const match = resourceId.match(/resourceGroups\/([^/]+)\/providers\/Microsoft\.Compute\/virtualMachines\/([^/]+)/i);
  if (match) {
    return { resourceGroup: match[1], vmName: match[2] };
  }
  return null;
}

/**
 * Start a stopped VM
 */
export const startVmFunction = inngest.createFunction(
  { id: 'start-vm', retries: 2 },
  { event: 'vm/start.requested' },
  async ({ event, step }) => {
    const { machineId } = event.data;
    const supabase = getSupabase();

    // Get machine details
    const machine = await step.run('get-machine', async () => {
      const { data, error } = await supabase
        .from('remote_machines')
        .select('id, name, azure_resource_id, status')
        .eq('id', machineId)
        .single();

      if (error || !data) {
        throw new Error(`Machine ${machineId} not found`);
      }
      return data;
    });

    if (!machine.azure_resource_id) {
      throw new Error(`Machine ${machineId} has no Azure resource ID`);
    }

    const parsed = parseAzureResourceId(machine.azure_resource_id);
    if (!parsed) {
      throw new Error(`Invalid Azure resource ID: ${machine.azure_resource_id}`);
    }

    // Start the VM
    await step.run('start-azure-vm', async () => {
      const { compute } = getAzureClients();

      await supabase
        .from('remote_machines')
        .update({ status: 'starting', updated_at: new Date().toISOString() })
        .eq('id', machineId);

      const poller = await compute.virtualMachines.beginStart(parsed.resourceGroup, parsed.vmName);
      await poller.pollUntilDone();

      console.log(`[VM Start] VM ${parsed.vmName} started`);
    });

    // Update status to active
    await step.run('update-status', async () => {
      await supabase
        .from('remote_machines')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', machineId);
    });

    return { success: true, machineId, vmName: parsed.vmName };
  }
);

/**
 * Stop (deallocate) a running VM
 */
export const stopVmFunction = inngest.createFunction(
  { id: 'stop-vm', retries: 2 },
  { event: 'vm/stop.requested' },
  async ({ event, step }) => {
    const { machineId } = event.data;
    const supabase = getSupabase();

    // Get machine details
    const machine = await step.run('get-machine', async () => {
      const { data, error } = await supabase
        .from('remote_machines')
        .select('id, name, azure_resource_id, status')
        .eq('id', machineId)
        .single();

      if (error || !data) {
        throw new Error(`Machine ${machineId} not found`);
      }
      return data;
    });

    if (!machine.azure_resource_id) {
      throw new Error(`Machine ${machineId} has no Azure resource ID`);
    }

    const parsed = parseAzureResourceId(machine.azure_resource_id);
    if (!parsed) {
      throw new Error(`Invalid Azure resource ID: ${machine.azure_resource_id}`);
    }

    // Deallocate the VM (stops and releases compute resources)
    await step.run('stop-azure-vm', async () => {
      const { compute } = getAzureClients();

      await supabase
        .from('remote_machines')
        .update({ status: 'stopping', updated_at: new Date().toISOString() })
        .eq('id', machineId);

      const poller = await compute.virtualMachines.beginDeallocate(parsed.resourceGroup, parsed.vmName);
      await poller.pollUntilDone();

      console.log(`[VM Stop] VM ${parsed.vmName} deallocated`);
    });

    // Update status to stopped
    await step.run('update-status', async () => {
      await supabase
        .from('remote_machines')
        .update({ status: 'stopped', updated_at: new Date().toISOString() })
        .eq('id', machineId);
    });

    return { success: true, machineId, vmName: parsed.vmName };
  }
);

/**
 * Delete a VM and all its Azure resources
 */
export const deleteVmFunction = inngest.createFunction(
  { id: 'delete-vm', retries: 2 },
  { event: 'vm/delete.requested' },
  async ({ event, step }) => {
    const { machineId, azureResourceId, resourceGroup } = event.data;
    const supabase = getSupabase();

    // If we have azure_resource_id, parse it; otherwise use provided resourceGroup
    let rgToDelete = resourceGroup;

    if (azureResourceId && !rgToDelete) {
      const parsed = parseAzureResourceId(azureResourceId);
      if (parsed) {
        rgToDelete = parsed.resourceGroup;
      }
    }

    if (!rgToDelete) {
      console.log(`[VM Delete] No resource group to delete for machine ${machineId}`);
      return { success: true, machineId, message: 'No Azure resources to clean up' };
    }

    // Delete the entire resource group (this deletes all resources in it)
    await step.run('delete-resource-group', async () => {
      const { resource } = getAzureClients();

      console.log(`[VM Delete] Deleting resource group: ${rgToDelete}`);

      try {
        const poller = await resource.resourceGroups.beginDelete(rgToDelete);
        await poller.pollUntilDone();
        console.log(`[VM Delete] Resource group ${rgToDelete} deleted`);
      } catch (err: unknown) {
        // Resource group might already be deleted
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ResourceGroupNotFound') || message.includes('not found')) {
          console.log(`[VM Delete] Resource group ${rgToDelete} already deleted`);
        } else {
          throw err;
        }
      }
    });

    // Clean up database record if it still exists
    await step.run('cleanup-database', async () => {
      if (machineId) {
        await supabase.from('remote_machines').delete().eq('id', machineId);
        console.log(`[VM Delete] Database record ${machineId} cleaned up`);
      }
    });

    return { success: true, machineId, resourceGroup: rgToDelete };
  }
);
