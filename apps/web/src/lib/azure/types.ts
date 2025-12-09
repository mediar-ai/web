/**
 * Azure VM Management Types
 * Provides type-safe interfaces for Azure resource operations
 */

// Azure Resource ID components
export interface AzureResourceId {
  subscriptionId: string;
  resourceGroup: string;
  provider?: string;
  resourceType?: string;
  resourceName: string;
}

// VM-specific resource ID
export interface AzureVmResourceId extends AzureResourceId {
  provider: 'Microsoft.Compute';
  resourceType: 'virtualMachines';
}

// Azure VM power states
export type VmPowerState =
  | 'running'
  | 'deallocated'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'deallocating'
  | 'unknown';

// Azure provisioning states
export type VmProvisioningState =
  | 'Succeeded'
  | 'Failed'
  | 'Updating'
  | 'Creating'
  | 'Deleting'
  | 'Migrating'
  | 'unknown';

// Unified VM state
export interface VmState {
  powerState: VmPowerState;
  provisioningState: VmProvisioningState;
  extensionsReady: boolean;
  blockedExtensions: string[];
  lastUpdated: Date;
}

// VM operation types
export type VmOperationType =
  | 'start'
  | 'stop'
  | 'restart'
  | 'deallocate'
  | 'run_command'
  | 'update_version';

// VM operation status
export type VmOperationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

// VM operation record (for tracking)
export interface VmOperation {
  operationId: string;
  machineId: number;
  type: VmOperationType;
  status: VmOperationStatus;
  initiatedBy: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  details?: Record<string, unknown>;
}

// VM operation result
export interface VmOperationResult {
  success: boolean;
  operationId: string;
  message: string;
  vmName: string;
  resourceGroup: string;
  state?: VmState;
  output?: string;
  error?: string;
  timedOut?: boolean;
}

// Run command options
export interface RunCommandOptions {
  script: string[];
  timeoutMs?: number;
  parameters?: Record<string, string>;
}

// Run command result
export interface RunCommandResult {
  success: boolean;
  output: string;
  timedOut: boolean;
  exitCode?: number;
}

// Machine with Azure info
export interface MachineWithAzure {
  id: number;
  name: string;
  azureResourceId: string | null;
  mcpEndpoint: string | null;
  healthEndpoint: string | null;
  status: string;
  healthStatus: string;
  vmState?: VmState;
  terraformKey?: string;
}

// Power state mapping from Azure status codes
export const POWER_STATE_MAP: Record<string, VmPowerState> = {
  'PowerState/running': 'running',
  'PowerState/deallocated': 'deallocated',
  'PowerState/stopped': 'stopped',
  'PowerState/starting': 'starting',
  'PowerState/stopping': 'stopping',
  'PowerState/deallocating': 'deallocating',
} as const;

// VNC gateway base URL
export const VNC_GATEWAY_URL = 'https://vnc-gateway-e4mtrji55a-ue.a.run.app';
