/**
 * Azure VM Operations
 * Provides typed VM lifecycle operations with unified error handling
 */

import { randomUUID } from 'crypto';
import { getComputeClientForSubscription } from './client';
import { parseAzureVmResourceId } from './resource-parser';
import type {
  VmState,
  VmPowerState,
  VmProvisioningState,
  VmOperationResult,
  RunCommandOptions,
  RunCommandResult,
  POWER_STATE_MAP,
} from './types';

const powerStateMap: typeof POWER_STATE_MAP = {
  'PowerState/running': 'running',
  'PowerState/deallocated': 'deallocated',
  'PowerState/stopped': 'stopped',
  'PowerState/starting': 'starting',
  'PowerState/stopping': 'stopping',
  'PowerState/deallocating': 'deallocating',
};

/**
 * Get the current state of a VM
 */
export async function getVmState(azureResourceId: string): Promise<VmState> {
  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);

  const instanceView = await client.virtualMachines.instanceView(
    parsed.resourceGroup,
    parsed.resourceName
  );

  const statuses = instanceView.statuses || [];

  // Find power state
  const powerStatus = statuses.find(s => s.code?.startsWith('PowerState/'));
  const powerCode = powerStatus?.code || '';
  const powerState: VmPowerState = powerStateMap[powerCode] || 'unknown';

  // Find provisioning state
  const provisioningStatus = statuses.find(s =>
    s.code?.startsWith('ProvisioningState/')
  );
  const provisioningState: VmProvisioningState =
    (provisioningStatus?.code?.replace(
      'ProvisioningState/',
      ''
    ) as VmProvisioningState) || 'unknown';

  // Check extensions
  const extensions = instanceView.extensions || [];
  const blockedExtensions = extensions
    .filter(
      ext =>
        ext.statuses?.some(
          s =>
            s.code?.includes('Updating') ||
            s.code?.includes('Transitioning') ||
            s.level === 'Error'
        )
    )
    .map(ext => ext.name || 'unknown');

  return {
    powerState,
    provisioningState,
    extensionsReady: blockedExtensions.length === 0,
    blockedExtensions,
    lastUpdated: new Date(),
  };
}

/**
 * Start a VM
 */
export async function startVm(
  azureResourceId: string
): Promise<VmOperationResult> {
  const operationId = randomUUID();
  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);

  console.log(
    `[Azure VM] Starting ${parsed.resourceName} in ${parsed.resourceGroup} [op:${operationId}]`
  );

  try {
    // Start the VM (don't wait for completion)
    await client.virtualMachines.beginStart(
      parsed.resourceGroup,
      parsed.resourceName
    );

    return {
      success: true,
      operationId,
      message: `Start initiated for ${parsed.resourceName}. VM will be running in ~2 minutes.`,
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Azure VM] Start failed [op:${operationId}]:`, error);
    return {
      success: false,
      operationId,
      message: 'Start failed',
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
      error: errorMessage,
    };
  }
}

/**
 * Stop a VM (keeps allocation, still incurs compute charges)
 */
export async function stopVm(
  azureResourceId: string
): Promise<VmOperationResult> {
  const operationId = randomUUID();
  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);

  console.log(
    `[Azure VM] Stopping ${parsed.resourceName} in ${parsed.resourceGroup} [op:${operationId}]`
  );

  try {
    await client.virtualMachines.beginPowerOff(
      parsed.resourceGroup,
      parsed.resourceName
    );

    return {
      success: true,
      operationId,
      message: `Stop initiated for ${parsed.resourceName}. VM will stop in ~1 minute.`,
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Azure VM] Stop failed [op:${operationId}]:`, error);
    return {
      success: false,
      operationId,
      message: 'Stop failed',
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
      error: errorMessage,
    };
  }
}

/**
 * Deallocate a VM (releases compute resources, no compute charges)
 */
export async function deallocateVm(
  azureResourceId: string
): Promise<VmOperationResult> {
  const operationId = randomUUID();
  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);

  console.log(
    `[Azure VM] Deallocating ${parsed.resourceName} in ${parsed.resourceGroup} [op:${operationId}]`
  );

  try {
    await client.virtualMachines.beginDeallocate(
      parsed.resourceGroup,
      parsed.resourceName
    );

    return {
      success: true,
      operationId,
      message: `Deallocate initiated for ${parsed.resourceName}. VM will be deallocated in ~2 minutes.`,
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Azure VM] Deallocate failed [op:${operationId}]:`, error);
    return {
      success: false,
      operationId,
      message: 'Deallocate failed',
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
      error: errorMessage,
    };
  }
}

/**
 * Restart a VM
 */
export async function restartVm(
  azureResourceId: string
): Promise<VmOperationResult> {
  const operationId = randomUUID();
  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);

  console.log(
    `[Azure VM] Restarting ${parsed.resourceName} in ${parsed.resourceGroup} [op:${operationId}]`
  );

  try {
    await client.virtualMachines.beginRestart(
      parsed.resourceGroup,
      parsed.resourceName
    );

    return {
      success: true,
      operationId,
      message: `Restart initiated for ${parsed.resourceName}. VM will be back online in ~2 minutes.`,
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Azure VM] Restart failed [op:${operationId}]:`, error);
    return {
      success: false,
      operationId,
      message: 'Restart failed',
      vmName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
      error: errorMessage,
    };
  }
}

/**
 * Run a PowerShell command on a VM with timeout
 */
export async function runCommand(
  azureResourceId: string,
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);
  const timeoutMs = options.timeoutMs || 120000; // Default 2 minutes

  console.log(
    `[Azure VM] Running command on ${parsed.resourceName} (timeout: ${timeoutMs}ms)`
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const poller = await client.virtualMachines.beginRunCommand(
      parsed.resourceGroup,
      parsed.resourceName,
      {
        commandId: 'RunPowerShellScript',
        script: options.script,
        parameters: options.parameters
          ? Object.entries(options.parameters).map(([name, value]) => ({
              name,
              value,
            }))
          : undefined,
      }
    );

    // Poll with timeout
    const result = await Promise.race([
      poller.pollUntilDone(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Operation timed out'));
        });
      }),
    ]);

    clearTimeout(timeoutId);
    const output = result.value?.[0]?.message || '';

    return {
      success: true,
      output,
      timedOut: false,
    };
  } catch (error: unknown) {
    clearTimeout(timeoutId);

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage === 'Operation timed out') {
      console.warn(
        `[Azure VM] Command timed out on ${parsed.resourceName} after ${timeoutMs}ms`
      );
      return {
        success: false,
        output: `Operation timed out after ${timeoutMs / 1000}s`,
        timedOut: true,
      };
    }

    console.error(
      `[Azure VM] Command failed on ${parsed.resourceName}:`,
      error
    );
    return {
      success: false,
      output: errorMessage,
      timedOut: false,
    };
  }
}

/**
 * Check if a VM is ready for operations (running and not updating)
 */
export async function isVmReady(
  azureResourceId: string
): Promise<{ ready: boolean; state: VmState; reason?: string }> {
  const state = await getVmState(azureResourceId);

  if (state.powerState !== 'running') {
    return {
      ready: false,
      state,
      reason: `VM is not running (state: ${state.powerState})`,
    };
  }

  if (state.provisioningState === 'Updating') {
    return {
      ready: false,
      state,
      reason: `VM has pending operations (state: ${state.provisioningState})`,
    };
  }

  if (!state.extensionsReady) {
    return {
      ready: false,
      state,
      reason: `VM extensions are not ready: ${state.blockedExtensions.join(', ')}`,
    };
  }

  return { ready: true, state };
}

/**
 * Get the public IP address of a VM by querying Azure
 */
export async function getVmPublicIp(
  azureResourceId: string
): Promise<string | null> {
  const { NetworkManagementClient } = await import('@azure/arm-network');
  const { getAzureCredential } = await import('./client');

  const parsed = parseAzureVmResourceId(azureResourceId);
  const client = getComputeClientForSubscription(parsed.subscriptionId);
  const credential = getAzureCredential();
  const networkClient = new NetworkManagementClient(credential, parsed.subscriptionId);

  try {
    const vm = await client.virtualMachines.get(
      parsed.resourceGroup,
      parsed.resourceName,
      { expand: 'instanceView' }
    );

    // Get the primary NIC
    const primaryNic = vm.networkProfile?.networkInterfaces?.find(
      nic => nic.primary
    ) || vm.networkProfile?.networkInterfaces?.[0];

    if (!primaryNic?.id) {
      console.log(`[Azure VM] No NIC found for ${parsed.resourceName}`);
      return null;
    }

    // Parse NIC ID to get resource group and name
    const nicIdParts = primaryNic.id.split('/');
    const nicResourceGroup = nicIdParts[nicIdParts.indexOf('resourceGroups') + 1];
    const nicName = nicIdParts[nicIdParts.length - 1];

    // Get the NIC details
    const nic = await networkClient.networkInterfaces.get(nicResourceGroup, nicName);

    // Find the public IP from IP configurations
    const publicIpId = nic.ipConfigurations?.[0]?.publicIPAddress?.id;
    if (!publicIpId) {
      console.log(`[Azure VM] No public IP associated with NIC ${nicName}`);
      return null;
    }

    // Parse public IP ID
    const ipIdParts = publicIpId.split('/');
    const ipResourceGroup = ipIdParts[ipIdParts.indexOf('resourceGroups') + 1];
    const ipName = ipIdParts[ipIdParts.length - 1];

    // Get the public IP
    const publicIp = await networkClient.publicIPAddresses.get(ipResourceGroup, ipName);

    console.log(`[Azure VM] Found public IP for ${parsed.resourceName}: ${publicIp.ipAddress}`);
    return publicIp.ipAddress || null;
  } catch (error) {
    console.error(`[Azure VM] Failed to get public IP:`, error);
    return null;
  }
}
