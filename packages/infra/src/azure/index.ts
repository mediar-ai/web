/**
 * Azure Infrastructure Module
 * Exports all Azure-related functionality with OpenTelemetry tracing
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
} from './types.js';

export { POWER_STATE_MAP, VNC_GATEWAY_URL } from './types.js';

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
} from './resource-parser.js';

// Azure clients
export {
  getSubscriptionId,
  getAzureCredential,
  getComputeClient,
  getNetworkClient,
  getComputeClientForSubscription,
  isAzureConfigured,
  resetClients,
} from './client.js';

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
  type AuditContext,
  type ActorType,
} from './vm-operations.js';

// Image Builder
export {
  buildImage,
  createImageTemplate,
  runImageBuild,
  deleteImageTemplate,
  listImageTemplates,
  getLatestGalleryImageVersion,
  checkImageBuilderPrerequisites,
  type ImageBuildOptions,
  type ImageBuildResult,
  type ImageBuildProgress,
} from './image-builder.js';
