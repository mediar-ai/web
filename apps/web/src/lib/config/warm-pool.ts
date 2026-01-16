/**
 * Warm Pool Configuration
 *
 * Manages a pool of pre-provisioned stopped VMs for trial sandboxes.
 * This reduces trial sandbox launch time from 5-10 minutes to ~30-60 seconds.
 */

export const WARM_POOL_CONFIG = {
  /** Target number of VMs to keep ready in the pool */
  targetSize: 1,

  /** Maximum number of pool VMs (safety limit) */
  maxPoolVms: 5,

  /** VM size for pool VMs (trial size) */
  vmSize: 'Standard_D2s_v3',

  /** Region for pool VMs */
  region: 'eastus',

  /** How often to check pool levels (in minutes) */
  checkIntervalMinutes: 5,

  /** Dedicated resource group for warm pool VMs */
  resourceGroup: 'mcp-warm-pool-rg',

  /** Pool VM name prefix */
  vmNamePrefix: 'pool-trial',

  /** Tags used to identify pool VMs */
  tags: {
    /** Tag indicating VM is in warm pool */
    poolWarm: 'pool:warm',
    /** Tag for available status */
    poolStatusAvailable: 'pool_status:available',
    /** Tag for claimed status */
    poolStatusClaimed: 'pool_status:claimed',
    /** Tag for claiming in progress */
    poolStatusClaiming: 'pool_status:claiming',
    /** Trial indicator */
    trial: 'trial:true',
  },

  /** Timeout for claiming a pool VM (in ms) */
  claimTimeoutMs: 120000, // 2 minutes

  /** How long to wait for VM to start after claiming (in ms) */
  startTimeoutMs: 180000, // 3 minutes
} as const;

/**
 * Generate a unique pool VM name
 */
export function generatePoolVmName(): string {
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${WARM_POOL_CONFIG.vmNamePrefix}-${suffix}`;
}

/**
 * Check if a tags array indicates the VM is in the warm pool
 */
export function isPoolVm(tags: string[]): boolean {
  return tags.includes(WARM_POOL_CONFIG.tags.poolWarm);
}

/**
 * Check if a tags array indicates the VM is available in the pool
 */
export function isPoolVmAvailable(tags: string[]): boolean {
  return (
    tags.includes(WARM_POOL_CONFIG.tags.poolWarm) &&
    tags.includes(WARM_POOL_CONFIG.tags.poolStatusAvailable)
  );
}

/**
 * Check if a tags array indicates the VM is being claimed
 */
export function isPoolVmClaiming(tags: string[]): boolean {
  return (
    tags.includes(WARM_POOL_CONFIG.tags.poolWarm) &&
    tags.includes(WARM_POOL_CONFIG.tags.poolStatusClaiming)
  );
}

/**
 * Get tags for a new pool VM
 */
export function getNewPoolVmTags(terraformKey: string): string[] {
  return [
    `terraform:${terraformKey}`,
    WARM_POOL_CONFIG.tags.poolWarm,
    WARM_POOL_CONFIG.tags.poolStatusAvailable,
    WARM_POOL_CONFIG.tags.trial,
  ];
}

/**
 * Update tags from available to claiming
 */
export function updateTagsToClaimingStatus(
  existingTags: string[],
  userId: string,
  requestId: string
): string[] {
  return existingTags
    .filter((t) => t !== WARM_POOL_CONFIG.tags.poolStatusAvailable)
    .concat([
      WARM_POOL_CONFIG.tags.poolStatusClaiming,
      `user:${userId}`,
      `request:${requestId}`,
    ]);
}

/**
 * Update tags from claiming to claimed
 */
export function updateTagsToClaimedStatus(existingTags: string[]): string[] {
  return existingTags
    .filter((t) => t !== WARM_POOL_CONFIG.tags.poolStatusClaiming)
    .concat([WARM_POOL_CONFIG.tags.poolStatusClaimed]);
}
