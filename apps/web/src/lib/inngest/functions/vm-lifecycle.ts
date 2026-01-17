import { inngest } from '../client';
import { ComputeManagementClient } from '@azure/arm-compute';
import { ResourceManagementClient } from '@azure/arm-resources';
import { getAzureCredential, getSubscriptionId } from '@/lib/azure/client';
import { createClient } from '@supabase/supabase-js';
import { getPostHogClient } from '@/lib/posthog-server';

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
    const { machineId, azureResourceId, resourceGroup, machineName } = event.data;
    const supabase = getSupabase();

    // Try multiple ways to determine resource group:
    // 1. Explicit resourceGroup param
    // 2. Parse from azure_resource_id
    // 3. Derive from machine name (pattern: mcp-{customer}-{name} -> mcp-{customer}-{name}-rg)
    let rgToDelete = resourceGroup;

    if (azureResourceId && !rgToDelete) {
      const parsed = parseAzureResourceId(azureResourceId);
      if (parsed) {
        rgToDelete = parsed.resourceGroup;
      }
    }

    // Fallback: derive from machine name pattern
    if (!rgToDelete && machineName && machineName.startsWith('mcp-')) {
      rgToDelete = `${machineName}-rg`;
      console.log(`[VM Delete] Derived resource group from machine name: ${rgToDelete}`);
    }

    if (!rgToDelete) {
      console.error(`[VM Delete] No resource group found for machine ${machineId} (name: ${machineName}, azureResourceId: ${azureResourceId})`);
      return { success: false, machineId, message: 'No Azure resources to clean up - could not determine resource group' };
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

/**
 * Cron job to auto-stop idle trial VMs after 30 minutes of inactivity
 * Runs every 5 minutes to check trial VMs
 */
export const autoStopIdleTrialVmsFunction = inngest.createFunction(
  {
    id: 'auto-stop-idle-trial-vms',
    retries: 1,
  },
  { cron: '*/5 * * * *' }, // Every 5 minutes
  async ({ step }) => {
    const supabase = getSupabase();
    const IDLE_THRESHOLD_MINUTES = 30;

    // Get all active trial VMs
    const trialVms = await step.run('get-idle-trial-vms', async () => {
      const idleThreshold = new Date(Date.now() - IDLE_THRESHOLD_MINUTES * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('remote_machines')
        .select('id, name, owner_user_id, azure_resource_id, updated_at, tags')
        .eq('status', 'active')
        .contains('tags', ['trial:true'])
        .lt('updated_at', idleThreshold);

      if (error) {
        console.error('[Auto-Stop Trial] Failed to fetch idle trial VMs:', error);
        return [];
      }

      return data || [];
    });

    if (trialVms.length === 0) {
      return { stopped: 0, message: 'No idle trial VMs to stop' };
    }

    console.log(`[Auto-Stop Trial] Found ${trialVms.length} idle trial VMs to stop`);

    // Stop each idle trial VM
    const results = await step.run('stop-idle-vms', async () => {
      const stopResults: Array<{ machineId: number; vmName: string; success: boolean; error?: string }> = [];

      for (const vm of trialVms) {
        if (!vm.azure_resource_id) {
          stopResults.push({ machineId: vm.id, vmName: vm.name, success: false, error: 'No Azure resource ID' });
          continue;
        }

        const parsed = parseAzureResourceId(vm.azure_resource_id);
        if (!parsed) {
          stopResults.push({ machineId: vm.id, vmName: vm.name, success: false, error: 'Invalid Azure resource ID' });
          continue;
        }

        try {
          const { compute } = getAzureClients();

          // Update status to stopping
          await supabase
            .from('remote_machines')
            .update({
              status: 'stopped',
              updated_at: new Date().toISOString(),
              provisioning_step: JSON.stringify({ step: 'auto-stopped', status: 'success', message: 'Trial VM auto-stopped after 30min idle' })
            })
            .eq('id', vm.id);

          // Deallocate the VM
          const poller = await compute.virtualMachines.beginDeallocate(parsed.resourceGroup, parsed.vmName);
          await poller.pollUntilDone();

          console.log(`[Auto-Stop Trial] VM ${vm.name} (${parsed.vmName}) auto-stopped after idle`);
          stopResults.push({ machineId: vm.id, vmName: vm.name, success: true });

          // Track trial auto-stop event
          try {
            const posthog = getPostHogClient();
            posthog.capture({
              distinctId: vm.owner_user_id || 'system',
              event: 'trial_sandbox_auto_stopped',
              properties: {
                machine_id: vm.id,
                machine_name: vm.name,
                idle_threshold_minutes: IDLE_THRESHOLD_MINUTES,
                reason: 'idle_timeout',
              },
            });
          } catch (e) {
            console.warn('[Auto-Stop Trial] Failed to track PostHog event:', e);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`[Auto-Stop Trial] Failed to stop VM ${vm.name}:`, errorMessage);
          stopResults.push({ machineId: vm.id, vmName: vm.name, success: false, error: errorMessage });
        }
      }

      return stopResults;
    });

    const successCount = results.filter(r => r.success).length;
    console.log(`[Auto-Stop Trial] Stopped ${successCount}/${trialVms.length} idle trial VMs`);

    return {
      stopped: successCount,
      total: trialVms.length,
      results,
    };
  }
);

/**
 * Cron job to auto-delete trial VMs older than 1 day
 * Runs every hour to clean up expired trial VMs
 */
export const autoDeleteOldTrialVmsFunction = inngest.createFunction(
  {
    id: 'auto-delete-old-trial-vms',
    retries: 1,
  },
  { cron: '0 * * * *' }, // Every hour
  async ({ step }) => {
    const supabase = getSupabase();
    const MAX_AGE_HOURS = 24;

    // Get all trial VMs older than 1 day
    const oldTrialVms = await step.run('get-old-trial-vms', async () => {
      const ageThreshold = new Date(Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('remote_machines')
        .select('id, name, owner_user_id, azure_resource_id, created_at, tags')
        .contains('tags', ['trial:true'])
        .lt('created_at', ageThreshold)
        .not('status', 'eq', 'deleted');

      if (error) {
        console.error('[Auto-Delete Trial] Failed to fetch old trial VMs:', error);
        return [];
      }

      return data || [];
    });

    if (oldTrialVms.length === 0) {
      return { deleted: 0, message: 'No old trial VMs to delete' };
    }

    console.log(`[Auto-Delete Trial] Found ${oldTrialVms.length} trial VMs older than ${MAX_AGE_HOURS} hours`);

    // Delete each old trial VM
    const results = await step.run('delete-old-vms', async () => {
      const deleteResults: Array<{ machineId: number; vmName: string; success: boolean; error?: string }> = [];

      for (const vm of oldTrialVms) {
        let rgToDelete: string | null = null;

        if (vm.azure_resource_id) {
          const parsed = parseAzureResourceId(vm.azure_resource_id);
          if (parsed) {
            rgToDelete = parsed.resourceGroup;
          }
        }

        try {
          // Delete Azure resources if we have a resource group
          if (rgToDelete) {
            const { resource } = getAzureClients();

            console.log(`[Auto-Delete Trial] Deleting resource group: ${rgToDelete}`);
            try {
              const poller = await resource.resourceGroups.beginDelete(rgToDelete);
              await poller.pollUntilDone();
              console.log(`[Auto-Delete Trial] Resource group ${rgToDelete} deleted`);
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              if (!message.includes('ResourceGroupNotFound') && !message.includes('not found')) {
                throw err;
              }
              console.log(`[Auto-Delete Trial] Resource group ${rgToDelete} already deleted`);
            }
          }

          // Mark as deleted in database (keep record for audit)
          await supabase
            .from('remote_machines')
            .update({
              status: 'deleted',
              updated_at: new Date().toISOString(),
              provisioning_step: JSON.stringify({ step: 'auto-deleted', status: 'success', message: 'Trial VM auto-deleted after 24h' })
            })
            .eq('id', vm.id);

          console.log(`[Auto-Delete Trial] VM ${vm.name} auto-deleted after ${MAX_AGE_HOURS}h`);
          deleteResults.push({ machineId: vm.id, vmName: vm.name, success: true });

          // Track trial auto-delete event
          try {
            const posthog = getPostHogClient();
            const vmAgeHours = vm.created_at
              ? Math.round((Date.now() - new Date(vm.created_at).getTime()) / (1000 * 60 * 60))
              : MAX_AGE_HOURS;

            posthog.capture({
              distinctId: vm.owner_user_id || 'system',
              event: 'trial_sandbox_auto_deleted',
              properties: {
                machine_id: vm.id,
                machine_name: vm.name,
                age_hours: vmAgeHours,
                max_age_hours: MAX_AGE_HOURS,
                reason: 'expired',
              },
            });
          } catch (e) {
            console.warn('[Auto-Delete Trial] Failed to track PostHog event:', e);
          }
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error(`[Auto-Delete Trial] Failed to delete VM ${vm.name}:`, errorMessage);
          deleteResults.push({ machineId: vm.id, vmName: vm.name, success: false, error: errorMessage });
        }
      }

      return deleteResults;
    });

    const successCount = results.filter(r => r.success).length;
    console.log(`[Auto-Delete Trial] Deleted ${successCount}/${oldTrialVms.length} old trial VMs`);

    return {
      deleted: successCount,
      total: oldTrialVms.length,
      results,
    };
  }
);
