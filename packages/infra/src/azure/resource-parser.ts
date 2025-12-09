/**
 * Azure Resource ID Parser
 * Provides type-safe parsing of Azure resource IDs
 */

import type { AzureResourceId, AzureVmResourceId } from './types';

export class AzureResourceParseError extends Error {
  constructor(
    message: string,
    public readonly resourceId: string
  ) {
    super(message);
    this.name = 'AzureResourceParseError';
  }
}

/**
 * Parse a generic Azure resource ID
 *
 * Format: /subscriptions/{subId}/resourceGroups/{rgName}/providers/{provider}/{type}/{name}
 */
export function parseAzureResourceId(resourceId: string): AzureResourceId {
  if (!resourceId) {
    throw new AzureResourceParseError('Resource ID is empty', resourceId);
  }

  const parts = resourceId.split('/');

  const subscriptionIndex = parts.indexOf('subscriptions');
  const rgIndex = parts.indexOf('resourceGroups');

  if (subscriptionIndex === -1) {
    throw new AzureResourceParseError(
      'Invalid Azure Resource ID: missing subscriptions segment',
      resourceId
    );
  }

  if (rgIndex === -1) {
    throw new AzureResourceParseError(
      'Invalid Azure Resource ID: missing resourceGroups segment',
      resourceId
    );
  }

  const subscriptionId = parts[subscriptionIndex + 1];
  const resourceGroup = parts[rgIndex + 1];

  if (!subscriptionId || !resourceGroup) {
    throw new AzureResourceParseError(
      'Invalid Azure Resource ID: missing subscription or resource group value',
      resourceId
    );
  }

  // Check for provider info (optional for some resource types)
  const providersIndex = parts.indexOf('providers');
  let provider: string | undefined;
  let resourceType: string | undefined;
  let resourceName: string;

  if (providersIndex !== -1) {
    provider = parts[providersIndex + 1];
    resourceType = parts[providersIndex + 2];
    resourceName = parts[providersIndex + 3];
  } else {
    // Fallback: last part is the resource name
    resourceName = parts[parts.length - 1];
  }

  if (!resourceName) {
    throw new AzureResourceParseError(
      'Invalid Azure Resource ID: missing resource name',
      resourceId
    );
  }

  return {
    subscriptionId,
    resourceGroup,
    provider,
    resourceType,
    resourceName,
  };
}

/**
 * Parse an Azure VM resource ID specifically
 *
 * Validates that the resource is a Virtual Machine
 */
export function parseAzureVmResourceId(resourceId: string): AzureVmResourceId {
  const parsed = parseAzureResourceId(resourceId);

  // Validate it's a VM
  const parts = resourceId.split('/');
  const vmIndex = parts.indexOf('virtualMachines');

  if (vmIndex === -1) {
    throw new AzureResourceParseError(
      'Invalid Azure VM Resource ID: not a virtualMachines resource',
      resourceId
    );
  }

  const vmName = parts[vmIndex + 1];
  if (!vmName) {
    throw new AzureResourceParseError(
      'Invalid Azure VM Resource ID: missing VM name',
      resourceId
    );
  }

  return {
    subscriptionId: parsed.subscriptionId,
    resourceGroup: parsed.resourceGroup,
    provider: 'Microsoft.Compute',
    resourceType: 'virtualMachines',
    resourceName: vmName,
  };
}

/**
 * Build an Azure resource ID from components
 */
export function buildAzureResourceId(resource: AzureResourceId): string {
  let id = `/subscriptions/${resource.subscriptionId}/resourceGroups/${resource.resourceGroup}`;

  if (resource.provider && resource.resourceType) {
    id += `/providers/${resource.provider}/${resource.resourceType}/${resource.resourceName}`;
  }

  return id;
}

/**
 * Build an Azure VM resource ID
 */
export function buildAzureVmResourceId(
  subscriptionId: string,
  resourceGroup: string,
  vmName: string
): string {
  return `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
}

/**
 * Extract VM name from a machine's MCP endpoint
 * Format: http://{ip}:8080/mcp or http://{hostname}:8080/mcp
 */
export function extractHostFromEndpoint(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Validate an Azure resource ID format without throwing
 */
export function isValidAzureResourceId(resourceId: string): boolean {
  try {
    parseAzureResourceId(resourceId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an Azure VM resource ID format without throwing
 */
export function isValidAzureVmResourceId(resourceId: string): boolean {
  try {
    parseAzureVmResourceId(resourceId);
    return true;
  } catch {
    return false;
  }
}
