import { createClerkClient } from '@clerk/nextjs/server';

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
});

interface CacheEntry {
  name: string;
  timestamp: number;
}

// Global cache maps to persist across warm starts
const orgNameCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<string | null>>();

const CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes cache

/**
 * Get organization name with in-memory caching and request deduplication
 */
export async function getOrganizationName(orgId: string): Promise<string | null> {
  if (!orgId) return null;

  const now = Date.now();
  const cached = orgNameCache.get(orgId);

  // Return cached value if valid
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.name;
  }

  // If a request for this ID is already in flight, return that promise
  if (pendingRequests.has(orgId)) {
    return pendingRequests.get(orgId)!;
  }

  // Create new fetch promise
  const fetchPromise = (async () => {
    try {
      const org = await clerkClient.organizations.getOrganization({
        organizationId: orgId,
      });

      if (org && org.name) {
        orgNameCache.set(orgId, {
          name: org.name,
          timestamp: Date.now(),
        });
        return org.name;
      }
    } catch (error) {
      // Log warning but don't crash
      console.warn(`[ClerkCache] Failed to fetch organization ${orgId}:`, error);
    }
    return null;
  })();

  // Store pending request
  pendingRequests.set(orgId, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    // Clean up pending request
    pendingRequests.delete(orgId);
  }
}

/**
 * Batch fetch organization names
 * Efficiently handles duplicates and uses caching
 */
export async function getOrganizationNames(orgIds: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(orgIds)].filter(Boolean);
  const results: Record<string, string> = {};

  // Execute all fetches in parallel
  // The logic inside getOrganizationName handles caching and request deduplication
  await Promise.all(
    uniqueIds.map(async (id) => {
      const name = await getOrganizationName(id);
      if (name) {
        results[id] = name;
      }
    })
  );

  return results;
}
