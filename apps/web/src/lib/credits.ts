/**
 * Credits System Configuration
 *
 * Pricing model: 1 credit ≈ 1 minute of workflow execution
 * - Workflow execution costs ~$0.50/min, so credits range from $0.50 (starter) to $0.33 (pro)
 * - VMs are charged per-minute at a lower rate (1 credit = ~5 min VM time)
 */

// Credit packages available for purchase
export const CREDIT_PACKAGES = [
  {
    id: 'starter',
    name: 'Starter',
    credits: 30,
    price: 15, // USD - $0.50/credit (30 min workflow time)
    popular: false,
    description: '30 minutes',
  },
  {
    id: 'standard',
    name: 'Standard',
    credits: 120,
    price: 50, // USD - $0.42/credit (2 hours workflow time)
    popular: true,
    description: '2 hours - 16% off',
  },
  {
    id: 'pro',
    name: 'Pro',
    credits: 300,
    price: 100, // USD - $0.33/credit (5 hours workflow time)
    popular: false,
    description: '5 hours - 34% off',
  },
] as const;

// VM costs in credits (per-minute billing, cheaper than workflow execution)
export const VM_COSTS = {
  // Per-launch cost (one-time setup)
  launch: {
    'Standard_D2s_v3': 5,  // 2 vCPU, 8GB - ~$2.50 worth
    'Standard_D4s_v3': 10, // 4 vCPU, 16GB - ~$5 worth
    'Standard_D8s_v3': 20, // 8 vCPU, 32GB - ~$10 worth
  },
  // Per-minute cost (charged while running)
  // 1 credit = ~5 min VM time, so ~$0.08-0.32/hr actual Azure cost covered
  perMinute: {
    'Standard_D2s_v3': 0.2,  // 12 credits/hr = ~$6/hr value
    'Standard_D4s_v3': 0.4,  // 24 credits/hr = ~$12/hr value
    'Standard_D8s_v3': 0.8,  // 48 credits/hr = ~$24/hr value
  },
} as const;

// VM Size info for UI display
export const VM_SIZES = [
  {
    id: 'Standard_D2s_v3',
    name: 'Small',
    specs: '2 vCPUs, 8GB RAM',
    launchCost: VM_COSTS.launch['Standard_D2s_v3'],
    perMinuteCost: VM_COSTS.perMinute['Standard_D2s_v3'],
    perHourCost: Math.round(VM_COSTS.perMinute['Standard_D2s_v3'] * 60), // 12 credits/hr
    recommended: false,
  },
  {
    id: 'Standard_D4s_v3',
    name: 'Medium',
    specs: '4 vCPUs, 16GB RAM',
    launchCost: VM_COSTS.launch['Standard_D4s_v3'],
    perMinuteCost: VM_COSTS.perMinute['Standard_D4s_v3'],
    perHourCost: Math.round(VM_COSTS.perMinute['Standard_D4s_v3'] * 60), // 24 credits/hr
    recommended: true,
  },
  {
    id: 'Standard_D8s_v3',
    name: 'Large',
    specs: '8 vCPUs, 32GB RAM',
    launchCost: VM_COSTS.launch['Standard_D8s_v3'],
    perMinuteCost: VM_COSTS.perMinute['Standard_D8s_v3'],
    perHourCost: Math.round(VM_COSTS.perMinute['Standard_D8s_v3'] * 60), // 48 credits/hr
    recommended: false,
  },
] as const;

export type VmSizeId = keyof typeof VM_COSTS.launch;

/**
 * Calculate credits from USD purchase amount
 * Uses the best matching package rate (Pro tier = 3 credits/$)
 */
export function calculateCreditsFromPurchase(amountUsd: number): number {
  // Find the best rate (highest credits per dollar)
  const rates = CREDIT_PACKAGES.map(p => ({
    rate: p.credits / p.price,
    package: p,
  })).sort((a, b) => b.rate - a.rate);

  // Use the best rate for custom amounts
  const bestRate = rates[0].rate;
  return Math.floor(amountUsd * bestRate);
}

/**
 * Get the launch cost for a VM size
 */
export function getVmLaunchCost(vmSize: string): number {
  return VM_COSTS.launch[vmSize as VmSizeId] || VM_COSTS.launch['Standard_D4s_v3'];
}

/**
 * Get the per-minute cost for a VM size
 */
export function getVmPerMinuteCost(vmSize: string): number {
  return VM_COSTS.perMinute[vmSize as VmSizeId] || VM_COSTS.perMinute['Standard_D4s_v3'];
}

/**
 * Get the hourly cost for a VM size (for display)
 */
export function getVmHourlyCost(vmSize: string): number {
  return Math.round(getVmPerMinuteCost(vmSize) * 60);
}

/**
 * Estimate total cost for running a VM
 */
export function estimateVmCost(vmSize: string, minutes: number): {
  launchCost: number;
  runningCost: number;
  totalCost: number;
} {
  const launchCost = getVmLaunchCost(vmSize);
  const runningCost = Math.round(getVmPerMinuteCost(vmSize) * minutes);
  return {
    launchCost,
    runningCost,
    totalCost: launchCost + runningCost,
  };
}
