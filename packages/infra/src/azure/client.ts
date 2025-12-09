/**
 * Azure Client Singletons
 * Provides centralized, reusable Azure SDK clients
 */

import { ComputeManagementClient } from '@azure/arm-compute';
import { NetworkManagementClient } from '@azure/arm-network';
import { ClientSecretCredential, DefaultAzureCredential, type TokenCredential } from '@azure/identity';

// Singleton instances
let computeClient: ComputeManagementClient | null = null;
let networkClient: NetworkManagementClient | null = null;
let credential: TokenCredential | null = null;

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
 * Get or create the Azure credential
 *
 * Uses ClientSecretCredential if environment variables are set,
 * otherwise falls back to DefaultAzureCredential for local development.
 */
export function getAzureCredential(): TokenCredential {
  if (!credential) {
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tenantId = process.env.AZURE_TENANT_ID;

    if (clientId && clientSecret && tenantId) {
      // Use explicit ClientSecretCredential for reliability on Vercel
      console.log('[Azure] Using ClientSecretCredential (service principal)');
      credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    } else {
      // Fall back to DefaultAzureCredential for local dev (Azure CLI)
      console.log('[Azure] Using DefaultAzureCredential (local dev mode)');
      credential = new DefaultAzureCredential();
    }
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
