import { createClerkClient } from '@clerk/nextjs/server';
import { mapDbIdToClerkId } from './orgIdMapping';

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
      // In dev mode, map DB org IDs to dev Clerk org IDs
      const clerkOrgId = mapDbIdToClerkId(orgId);
      console.log(`[ClerkCache] Fetching org ${orgId} -> clerkId ${clerkOrgId}`);

      const org = await clerkClient.organizations.getOrganization({
        organizationId: clerkOrgId,
      });

      if (org && org.name) {
        // Cache by original orgId so callers get results keyed by what they passed
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

// User name caching
const userNameCache = new Map<string, CacheEntry>();
const pendingUserRequests = new Map<string, Promise<string | null>>();

/**
 * Get user display name with in-memory caching and request deduplication
 */
export async function getUserDisplayName(userId: string): Promise<string | null> {
  if (!userId) return null;

  const now = Date.now();
  const cached = userNameCache.get(userId);

  // Return cached value if valid
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.name;
  }

  // If a request for this ID is already in flight, return that promise
  if (pendingUserRequests.has(userId)) {
    return pendingUserRequests.get(userId)!;
  }

  // Create new fetch promise
  const fetchPromise = (async () => {
    try {
      const user = await clerkClient.users.getUser(userId);

      if (user) {
        // Build display name from available fields
        const displayName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.emailAddresses?.[0]?.emailAddress?.split('@')[0] || userId.slice(0, 8);

        userNameCache.set(userId, {
          name: displayName,
          timestamp: Date.now(),
        });
        return displayName;
      }
    } catch (error) {
      // Log warning but don't crash
      console.warn(`[ClerkCache] Failed to fetch user ${userId}:`, error);
    }
    return null;
  })();

  // Store pending request
  pendingUserRequests.set(userId, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    // Clean up pending request
    pendingUserRequests.delete(userId);
  }
}

/**
 * Batch fetch user display names
 * Efficiently handles duplicates and uses caching
 */
export async function getUserDisplayNames(userIds: string[]): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  const results: Record<string, string> = {};

  // Execute all fetches in parallel
  await Promise.all(
    uniqueIds.map(async (id) => {
      const name = await getUserDisplayName(id);
      if (name) {
        results[id] = name;
      }
    })
  );

  return results;
}
