/**
 * Execution cache utility for hybrid loading
 * Stores executions in localStorage for instant display while fetching fresh data
 */

import { Execution } from '@/lib/workflow-types';

const CACHE_KEY_PREFIX = 'executions-cache-';
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface CachedExecutions {
  executions: Execution[];
  totalExecutions: number;
  timestamp: number;
  filters: {
    workflowFilter?: string;
    statusFilter?: string;
    machineFilter?: string;
    searchQuery?: string;
    searchField?: string;
    searchMode?: string;
    page: number;
    pageSize: number;
  };
}

/**
 * Generate cache key based on filters and organization
 */
function getCacheKey(
  viewOrgId: string | null,
  workflowFilter?: string,
  statusFilter?: string,
  machineFilter?: string,
  searchQuery?: string,
  searchField?: string,
  searchMode?: string,
  page?: number,
  pageSize?: number
): string {
  const parts = [
    CACHE_KEY_PREFIX,
    viewOrgId || 'default',
    workflowFilter || 'all',
    statusFilter || 'all',
    machineFilter || 'all',
    searchQuery || 'none',
    searchField || 'all',
    searchMode || 'contains',
    page || 1,
    pageSize || 50,
  ];
  return parts.join('-');
}

/**
 * Save executions to cache
 */
export function saveExecutionsToCache(
  executions: Execution[],
  totalExecutions: number,
  viewOrgId: string | null,
  workflowFilter?: string,
  statusFilter?: string,
  machineFilter?: string,
  searchQuery?: string,
  searchField?: string,
  searchMode?: string,
  page?: number,
  pageSize?: number
): void {
  if (typeof window === 'undefined') return;

  const cacheKey = getCacheKey(
    viewOrgId,
    workflowFilter,
    statusFilter,
    machineFilter,
    searchQuery,
    searchField,
    searchMode,
    page,
    pageSize
  );

  const cached: CachedExecutions = {
    executions,
    totalExecutions,
    timestamp: Date.now(),
    filters: {
      workflowFilter,
      statusFilter,
      machineFilter,
      searchQuery,
      searchField,
      searchMode,
      page: page || 1,
      pageSize: pageSize || 50,
    },
  };

  try {
    localStorage.setItem(cacheKey, JSON.stringify(cached));
  } catch (error) {
    // Quota exceeded or other error - ignore
    console.warn('Failed to cache executions:', error);
  }
}

/**
 * Load executions from cache
 * Returns null if cache is expired or doesn't exist
 */
export function loadExecutionsFromCache(
  viewOrgId: string | null,
  workflowFilter?: string,
  statusFilter?: string,
  machineFilter?: string,
  searchQuery?: string,
  searchField?: string,
  searchMode?: string,
  page?: number,
  pageSize?: number
): { executions: Execution[]; totalExecutions: number } | null {
  if (typeof window === 'undefined') return null;

  const cacheKey = getCacheKey(
    viewOrgId,
    workflowFilter,
    statusFilter,
    machineFilter,
    searchQuery,
    searchField,
    searchMode,
    page,
    pageSize
  );

  try {
    const cached = localStorage.getItem(cacheKey);
    if (!cached) return null;

    const parsed: CachedExecutions = JSON.parse(cached);

    // Check if cache is expired
    const age = Date.now() - parsed.timestamp;
    if (age > CACHE_EXPIRY_MS) {
      // Cache expired, remove it
      localStorage.removeItem(cacheKey);
      return null;
    }

    return {
      executions: parsed.executions,
      totalExecutions: parsed.totalExecutions,
    };
  } catch (error) {
    // Parse error or other issue - ignore
    console.warn('Failed to load cached executions:', error);
    return null;
  }
}

/**
 * Clear all execution caches (useful when organization changes)
 */
export function clearExecutionCache(viewOrgId?: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        if (!viewOrgId || key.includes(viewOrgId)) {
          localStorage.removeItem(key);
        }
      }
    }
  } catch (error) {
    console.warn('Failed to clear execution cache:', error);
  }
}
