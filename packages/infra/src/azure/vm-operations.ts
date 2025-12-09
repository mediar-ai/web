/**
 * Azure VM Operations with OpenTelemetry Tracing
 */

import { getComputeClient, getNetworkClient } from './client.js';
import { parseAzureVmResourceId } from './resource-parser.js';
import { VmState, VmOperationResult, POWER_STATE_MAP, RunCommandOptions, RunCommandResult } from './types.js';
import { withSpan, addSpanEvent, InfraAttributes, type AuditContext, type ActorType } from '../telemetry/index.js';

const DEFAULT_AUDIT_CONTEXT: AuditContext = {
  actor: 'system',
  actorType: 'system',
};

/**
 * Get current VM state
 */
export async function getVmState(
  resourceIdOrName: string,
  resourceGroup?: string
): Promise<VmState> {
  const computeClient = getComputeClient();

  let vmName: string;
  let rg: string;

  if (resourceIdOrName.startsWith('/subscriptions/')) {
    const parsed = parseAzureVmResourceId(resourceIdOrName);
    vmName = parsed.resourceName;
    rg = parsed.resourceGroup;
  } else {
    vmName = resourceIdOrName;
    rg = resourceGroup || '';
  }

  const vm = await computeClient.virtualMachines.instanceView(rg, vmName);
  const statuses = vm.statuses || [];

  let powerState: VmState['powerState'] = 'unknown';
  let provisioningState: VmState['provisioningState'] = 'unknown';

  for (const status of statuses) {
    if (status.code?.startsWith('PowerState/')) {
      powerState = POWER_STATE_MAP[status.code] || 'unknown';
    }
    if (status.code?.startsWith('ProvisioningState/')) {
      provisioningState = status.code.replace('ProvisioningState/', '') as VmState['provisioningState'];
    }
  }

  const vmExtensions = vm.extensions || [];
  const blockedExtensions = vmExtensions
    .filter(ext => ext.statuses?.some(s => s.level === 'Error'))
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
  resourceId: string,
  auditContext: AuditContext = DEFAULT_AUDIT_CONTEXT
): Promise<VmOperationResult> {
  const parsed = parseAzureVmResourceId(resourceId);

  return withSpan(
    'vm.start',
    {
      operation: 'vm.start',
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: 'vm',
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    },
    async (span) => {
      addSpanEvent(span, 'starting_vm');

      const computeClient = getComputeClient();
      const poller = await computeClient.virtualMachines.beginStart(
        parsed.resourceGroup,
        parsed.resourceName
      );

      addSpanEvent(span, 'polling_operation');
      await poller.pollUntilDone();

      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);

      return {
        success: true,
        operationId: `start-${Date.now()}`,
        message: `VM ${parsed.resourceName} started successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state,
      };
    }
  );
}

/**
 * Stop a VM (OS shutdown)
 */
export async function stopVm(
  resourceId: string,
  auditContext: AuditContext = DEFAULT_AUDIT_CONTEXT
): Promise<VmOperationResult> {
  const parsed = parseAzureVmResourceId(resourceId);

  return withSpan(
    'vm.stop',
    {
      operation: 'vm.stop',
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: 'vm',
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    },
    async (span) => {
      addSpanEvent(span, 'stopping_vm');

      const computeClient = getComputeClient();
      const poller = await computeClient.virtualMachines.beginPowerOff(
        parsed.resourceGroup,
        parsed.resourceName
      );

      addSpanEvent(span, 'polling_operation');
      await poller.pollUntilDone();

      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);

      return {
        success: true,
        operationId: `stop-${Date.now()}`,
        message: `VM ${parsed.resourceName} stopped successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state,
      };
    }
  );
}

/**
 * Deallocate a VM (release compute resources)
 */
export async function deallocateVm(
  resourceId: string,
  auditContext: AuditContext = DEFAULT_AUDIT_CONTEXT
): Promise<VmOperationResult> {
  const parsed = parseAzureVmResourceId(resourceId);

  return withSpan(
    'vm.deallocate',
    {
      operation: 'vm.deallocate',
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: 'vm',
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    },
    async (span) => {
      addSpanEvent(span, 'deallocating_vm');

      const computeClient = getComputeClient();
      const poller = await computeClient.virtualMachines.beginDeallocate(
        parsed.resourceGroup,
        parsed.resourceName
      );

      addSpanEvent(span, 'polling_operation');
      await poller.pollUntilDone();

      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);

      return {
        success: true,
        operationId: `deallocate-${Date.now()}`,
        message: `VM ${parsed.resourceName} deallocated successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state,
      };
    }
  );
}

/**
 * Restart a VM
 */
export async function restartVm(
  resourceId: string,
  auditContext: AuditContext = DEFAULT_AUDIT_CONTEXT
): Promise<VmOperationResult> {
  const parsed = parseAzureVmResourceId(resourceId);

  return withSpan(
    'vm.restart',
    {
      operation: 'vm.restart',
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: 'vm',
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
    },
    async (span) => {
      addSpanEvent(span, 'restarting_vm');

      const computeClient = getComputeClient();
      const poller = await computeClient.virtualMachines.beginRestart(
        parsed.resourceGroup,
        parsed.resourceName
      );

      addSpanEvent(span, 'polling_operation');
      await poller.pollUntilDone();

      const state = await getVmState(resourceId);
      span.setAttribute(InfraAttributes.VM_POWER_STATE, state.powerState);

      return {
        success: true,
        operationId: `restart-${Date.now()}`,
        message: `VM ${parsed.resourceName} restarted successfully`,
        vmName: parsed.resourceName,
        resourceGroup: parsed.resourceGroup,
        state,
      };
    }
  );
}

/**
 * Run a PowerShell command on a VM
 */
export async function runCommand(
  resourceId: string,
  options: RunCommandOptions,
  auditContext: AuditContext = DEFAULT_AUDIT_CONTEXT
): Promise<RunCommandResult> {
  const parsed = parseAzureVmResourceId(resourceId);

  return withSpan(
    'vm.run_command',
    {
      operation: 'vm.run_command',
      actor: auditContext.actor,
      actorType: auditContext.actorType,
      resourceType: 'vm',
      resourceId,
      resourceName: parsed.resourceName,
      resourceGroup: parsed.resourceGroup,
      script_lines: options.script.length,
    },
    async (span) => {
      addSpanEvent(span, 'executing_command', { script_lines: options.script.length });

      const computeClient = getComputeClient();
      const timeout = options.timeoutMs || 120000;

      const poller = await computeClient.virtualMachines.beginRunCommand(
        parsed.resourceGroup,
        parsed.resourceName,
        {
          commandId: 'RunPowerShellScript',
          script: options.script,
          parameters: options.parameters
            ? Object.entries(options.parameters).map(([name, value]) => ({ name, value }))
            : undefined,
        }
      );

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Command timeout')), timeout)
      );

      try {
        const result = await Promise.race([poller.pollUntilDone(), timeoutPromise]);
        const output = result.value?.[0]?.message || '';
        const exitCode = output.includes('ERROR') ? 1 : 0;

        span.setAttribute('command.exit_code', exitCode);
        span.setAttribute('command.output_length', output.length);

        return {
          success: exitCode === 0,
          output,
          timedOut: false,
          exitCode,
        };
      } catch (error) {
        if (error instanceof Error && error.message === 'Command timeout') {
          span.setAttribute('command.timed_out', true);
          return {
            success: false,
            output: '',
            timedOut: true,
          };
        }
        throw error;
      }
    }
  );
}

/**
 * Check if VM is ready (running with no blocked extensions)
 */
export async function isVmReady(resourceId: string): Promise<boolean> {
  const state = await getVmState(resourceId);
  return state.powerState === 'running' && state.extensionsReady;
}

/**
 * Get VM's public IP address
 */
export async function getVmPublicIp(resourceId: string): Promise<string | null> {
  const parsed = parseAzureVmResourceId(resourceId);
  const computeClient = getComputeClient();
  const networkClient = getNetworkClient();

  const vm = await computeClient.virtualMachines.get(
    parsed.resourceGroup,
    parsed.resourceName
  );

  const nicRef = vm.networkProfile?.networkInterfaces?.[0];
  if (!nicRef?.id) return null;

  const nicName = nicRef.id.split('/').pop();
  if (!nicName) return null;

  const nic = await networkClient.networkInterfaces.get(
    parsed.resourceGroup,
    nicName
  );

  const ipConfigRef = nic.ipConfigurations?.[0]?.publicIPAddress;
  if (!ipConfigRef?.id) return null;

  const ipName = ipConfigRef.id.split('/').pop();
  if (!ipName) return null;

  const publicIp = await networkClient.publicIPAddresses.get(
    parsed.resourceGroup,
    ipName
  );

  return publicIp.ipAddress || null;
}

// Re-export audit context type
export type { AuditContext, ActorType };
