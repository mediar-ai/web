import { AuditContext } from '../telemetry/index.js';
export { ActorType } from '../telemetry/index.js';
import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { TokenCredential } from '@azure/identity';
import '@opentelemetry/api';

/**
 * Azure VM Management Types
 * Provides type-safe interfaces for Azure resource operations
 */
interface AzureResourceId {
    subscriptionId: string;
    resourceGroup: string;
    provider?: string;
    resourceType?: string;
    resourceName: string;
}
interface AzureVmResourceId extends AzureResourceId {
    provider: 'Microsoft.Compute';
    resourceType: 'virtualMachines';
}
type VmPowerState = 'running' | 'deallocated' | 'stopped' | 'starting' | 'stopping' | 'deallocating' | 'unknown';
type VmProvisioningState = 'Succeeded' | 'Failed' | 'Updating' | 'Creating' | 'Deleting' | 'Migrating' | 'unknown';
interface VmState {
    powerState: VmPowerState;
    provisioningState: VmProvisioningState;
    extensionsReady: boolean;
    blockedExtensions: string[];
    lastUpdated: Date;
}
type VmOperationType = 'start' | 'stop' | 'restart' | 'deallocate' | 'run_command' | 'update_version';
type VmOperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
interface VmOperation {
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
interface VmOperationResult {
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
interface RunCommandOptions {
    script: string[];
    timeoutMs?: number;
    parameters?: Record<string, string>;
}
interface RunCommandResult {
    success: boolean;
    output: string;
    timedOut: boolean;
    exitCode?: number;
}
interface MachineWithAzure {
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
declare const POWER_STATE_MAP: Record<string, VmPowerState>;
declare const VNC_GATEWAY_URL = "https://vnc-gateway-e4mtrji55a-ue.a.run.app";

/**
 * Azure Resource ID Parser
 * Provides type-safe parsing of Azure resource IDs
 */

declare class AzureResourceParseError extends Error {
    readonly resourceId: string;
    constructor(message: string, resourceId: string);
}
/**
 * Parse a generic Azure resource ID
 *
 * Format: /subscriptions/{subId}/resourceGroups/{rgName}/providers/{provider}/{type}/{name}
 */
declare function parseAzureResourceId(resourceId: string): AzureResourceId;
/**
 * Parse an Azure VM resource ID specifically
 *
 * Validates that the resource is a Virtual Machine
 */
declare function parseAzureVmResourceId(resourceId: string): AzureVmResourceId;
/**
 * Build an Azure resource ID from components
 */
declare function buildAzureResourceId(resource: AzureResourceId): string;
/**
 * Build an Azure VM resource ID
 */
declare function buildAzureVmResourceId(subscriptionId: string, resourceGroup: string, vmName: string): string;
/**
 * Extract VM name from a machine's MCP endpoint
 * Format: http://{ip}:8080/mcp or http://{hostname}:8080/mcp
 */
declare function extractHostFromEndpoint(endpoint: string): string | null;
/**
 * Validate an Azure resource ID format without throwing
 */
declare function isValidAzureResourceId(resourceId: string): boolean;
/**
 * Validate an Azure VM resource ID format without throwing
 */
declare function isValidAzureVmResourceId(resourceId: string): boolean;

/**
 * Azure Client Singletons
 * Provides centralized, reusable Azure SDK clients
 */

/**
 * Get the Azure subscription ID from environment
 */
declare function getSubscriptionId(): string;
/**
 * Get or create the Azure credential
 *
 * Uses ClientSecretCredential if environment variables are set,
 * otherwise falls back to DefaultAzureCredential for local development.
 */
declare function getAzureCredential(): TokenCredential;
/**
 * Get or create the ComputeManagementClient singleton
 *
 * Used for VM operations: start, stop, restart, deallocate, run commands
 */
declare function getComputeClient(): ComputeManagementClient;
/**
 * Get or create the NetworkManagementClient singleton
 *
 * Used for: public IPs, network interfaces, NSGs
 */
declare function getNetworkClient(): NetworkManagementClient;
/**
 * Get a ComputeManagementClient for a specific subscription
 *
 * Use this when working with resources in different subscriptions
 */
declare function getComputeClientForSubscription(subscriptionId: string): ComputeManagementClient;
/**
 * Check if Azure credentials are configured
 */
declare function isAzureConfigured(): boolean;
/**
 * Reset all clients (useful for testing or credential refresh)
 */
declare function resetClients(): void;

/**
 * Azure VM Operations with OpenTelemetry Tracing
 */

/**
 * Get current VM state
 */
declare function getVmState(resourceIdOrName: string, resourceGroup?: string): Promise<VmState>;
/**
 * Start a VM
 */
declare function startVm(resourceId: string, auditContext?: AuditContext): Promise<VmOperationResult>;
/**
 * Stop a VM (OS shutdown)
 */
declare function stopVm(resourceId: string, auditContext?: AuditContext): Promise<VmOperationResult>;
/**
 * Deallocate a VM (release compute resources)
 */
declare function deallocateVm(resourceId: string, auditContext?: AuditContext): Promise<VmOperationResult>;
/**
 * Restart a VM
 */
declare function restartVm(resourceId: string, auditContext?: AuditContext): Promise<VmOperationResult>;
/**
 * Run a PowerShell command on a VM
 */
declare function runCommand(resourceId: string, options: RunCommandOptions, auditContext?: AuditContext): Promise<RunCommandResult>;
/**
 * Check if VM is ready (running with no blocked extensions)
 */
declare function isVmReady(resourceId: string): Promise<boolean>;
/**
 * Get VM's public IP address
 */
declare function getVmPublicIp(resourceId: string): Promise<string | null>;

/**
 * Azure Image Builder
 * Replaces Packer for building VM images with full TypeScript control.
 * Supports specialized images (no sysprep) for faster VM boot times.
 */
interface ImageBuildOptions {
    vmPassword: string;
    vncPassword: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3Endpoint?: string;
}
interface ImageBuildResult {
    success: boolean;
    imageId?: string;
    versionName?: string;
    templateName?: string;
    error?: string;
    runOutputId?: string;
}
interface ImageBuildProgress {
    step: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    message: string;
    runState?: string;
}
/**
 * Create an Image Builder template for the MCP image
 */
declare function createImageTemplate(templateName: string, options: ImageBuildOptions, onProgress?: (progress: ImageBuildProgress) => void): Promise<ImageBuildResult>;
/**
 * Start building an image from a template
 */
declare function runImageBuild(templateName: string, onProgress?: (progress: ImageBuildProgress) => void): Promise<ImageBuildResult>;
/**
 * Full image build workflow: create template + run build
 */
declare function buildImage(options: ImageBuildOptions, onProgress?: (progress: ImageBuildProgress) => void): Promise<ImageBuildResult>;
/**
 * Delete an image template
 */
declare function deleteImageTemplate(templateName: string): Promise<{
    success: boolean;
    error?: string;
}>;
/**
 * List all image templates
 */
declare function listImageTemplates(): Promise<{
    success: boolean;
    templates?: Array<{
        name: string;
        location: string;
        lastRunState?: string;
        lastRunTime?: Date;
    }>;
    error?: string;
}>;
/**
 * Get latest gallery image version
 */
declare function getLatestGalleryImageVersion(): Promise<{
    success: boolean;
    version?: string;
    imageId?: string;
    error?: string;
}>;
/**
 * Check if the Image Builder managed identity exists
 * If not, provides instructions to create it
 */
declare function checkImageBuilderPrerequisites(): Promise<{
    ready: boolean;
    missing: string[];
    instructions: string[];
}>;

export { AuditContext, type AzureResourceId, AzureResourceParseError, type AzureVmResourceId, type ImageBuildOptions, type ImageBuildProgress, type ImageBuildResult, type MachineWithAzure, POWER_STATE_MAP, type RunCommandOptions, type RunCommandResult, VNC_GATEWAY_URL, type VmOperation, type VmOperationResult, type VmOperationStatus, type VmOperationType, type VmPowerState, type VmProvisioningState, type VmState, buildAzureResourceId, buildAzureVmResourceId, buildImage, checkImageBuilderPrerequisites, createImageTemplate, deallocateVm, deleteImageTemplate, extractHostFromEndpoint, getAzureCredential, getComputeClient, getComputeClientForSubscription, getLatestGalleryImageVersion, getNetworkClient, getSubscriptionId, getVmPublicIp, getVmState, isAzureConfigured, isValidAzureResourceId, isValidAzureVmResourceId, isVmReady, listImageTemplates, parseAzureResourceId, parseAzureVmResourceId, resetClients, restartVm, runCommand, runImageBuild, startVm, stopVm };
