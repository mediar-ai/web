/**
 * Azure Client Singletons
 * Provides centralized, reusable Azure SDK clients
 */

import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { DefaultAzureCredential } from '@azure/identity';

// Singleton instances
let computeClient: ComputeManagementClient | null = null;
let networkClient: NetworkManagementClient | null = null;
let credential: DefaultAzureCredential | null = null;

/**
 * Get the Azure subscription ID from environment
 */
export function getSubscriptionId(): string {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  if (!subscriptionId) {
    throw new Error(
      'AZURE_SUBSCRIPTION_ID environment variable is not set. ' +
        'Please set it to your Azure subscription ID.'
    );
  }
  return subscriptionId;
}

/**
 * Get or create the DefaultAzureCredential
 *
 * Uses DefaultAzureCredential which supports:
 * - Environment variables (AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID)
 * - Managed Identity (when running in Azure)
 * - Azure CLI credentials (for local development)
 */
export function getAzureCredential(): DefaultAzureCredential {
  if (!credential) {
    credential = new DefaultAzureCredential();
  }
  return credential;
}

/**
 * Get or create the ComputeManagementClient singleton
 *
 * Used for VM operations: start, stop, restart, deallocate, run commands
 */
export function getComputeClient(): ComputeManagementClient {
  if (!computeClient) {
    const subscriptionId = getSubscriptionId();
    const cred = getAzureCredential();
    computeClient = new ComputeManagementClient(cred, subscriptionId);
  }
  return computeClient;
}

/**
 * Get or create the NetworkManagementClient singleton
 *
 * Used for: public IPs, network interfaces, NSGs
 */
export function getNetworkClient(): NetworkManagementClient {
  if (!networkClient) {
    const subscriptionId = getSubscriptionId();
    const cred = getAzureCredential();
    networkClient = new NetworkManagementClient(cred, subscriptionId);
  }
  return networkClient;
}

/**
 * Get a ComputeManagementClient for a specific subscription
 *
 * Use this when working with resources in different subscriptions
 */
export function getComputeClientForSubscription(
  subscriptionId: string
): ComputeManagementClient {
  const cred = getAzureCredential();
  return new ComputeManagementClient(cred, subscriptionId);
}

/**
 * Check if Azure credentials are configured
 */
export function isAzureConfigured(): boolean {
  try {
    getSubscriptionId();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reset all clients (useful for testing or credential refresh)
 */
export function resetClients(): void {
  computeClient = null;
  networkClient = null;
  credential = null;
}
