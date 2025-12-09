/**
 * Azure Service Layer
 *
 * Centralized Azure VM management with:
 * - Singleton clients for connection reuse
 * - Type-safe resource ID parsing
 * - Unified VM lifecycle operations
 * - Structured error handling
 *
 * Usage:
 *
 * import { startVm, getVmState, isAzureConfigured } from '@/lib/azure';
 *
 * if (isAzureConfigured()) {
 *   const result = await startVm(machine.azure_resource_id);
 *   if (result.success) {
 *     console.log(result.message);
 *   }
 * }
 */

// Types
export type {
  AzureResourceId,
  AzureVmResourceId,
  VmPowerState,
  VmProvisioningState,
  VmState,
  VmOperationType,
  VmOperationStatus,
  VmOperation,
  VmOperationResult,
  RunCommandOptions,
  RunCommandResult,
  MachineWithAzure,
} from './types';

export { POWER_STATE_MAP, VNC_GATEWAY_URL } from './types';

// Resource parsing
export {
  parseAzureResourceId,
  parseAzureVmResourceId,
  buildAzureResourceId,
  buildAzureVmResourceId,
  extractHostFromEndpoint,
  isValidAzureResourceId,
  isValidAzureVmResourceId,
  AzureResourceParseError,
} from './resource-parser';

// Azure clients
export {
  getSubscriptionId,
  getAzureCredential,
  getComputeClient,
  getNetworkClient,
  getComputeClientForSubscription,
  isAzureConfigured,
  resetClients,
} from './client';

// VM operations
export {
  getVmState,
  startVm,
  stopVm,
  deallocateVm,
  restartVm,
  runCommand,
  isVmReady,
  getVmPublicIp,
} from './vm-operations';

// VM provisioning
export { deleteVmResources } from './vm-provisioning';

// Image Builder (replaces Packer)
export type { ImageBuildOptions, ImageBuildResult, ImageBuildProgress } from './image-builder';
export {
  createImageTemplate,
  runImageBuild,
  buildImage,
  deleteImageTemplate,
  listImageTemplates,
  getLatestGalleryImageVersion,
  checkImageBuilderPrerequisites,
} from './image-builder';
