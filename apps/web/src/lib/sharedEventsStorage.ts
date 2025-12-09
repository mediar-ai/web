import { getRawEventsStorage } from './rawEventsStorage';
import type { LowLevelEvent } from '@/types';

/**
 * Shared storage utility for accessing cached events across multiple tabs/components
 * This leverages the existing IndexedDB storage and provides a unified interface
 */
export class SharedEventsStorage {
  private storage: ReturnType<typeof getRawEventsStorage>;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
    this.storage = getRawEventsStorage(userId);
  }

  /**
   * Initialize the storage - safe to call multiple times
   */
  async init(): Promise<void> {
    await this.storage.init();
  }

  /**
   * Get events from cache, with optional filtering for steps
   * @param limit - Maximum number of events to return
   * @param offset - Offset for pagination
   * @param filterUIEvents - If true, only return UI tree events (for steps tab)
   */
  async getCachedEvents(
    limit: number = 1000, 
    offset: number = 0, 
    filterUIEvents: boolean = false
  ): Promise<{
    events: LowLevelEvent[];
    hasMore: boolean;
    totalCached: number;
  }> {
    await this.init();
    
    // Load from IndexedDB
    const allCachedEvents = await this.storage.loadEvents(limit + offset);
    
    // Filter for UI events if requested (for steps tab)
    let filteredEvents = allCachedEvents;
    if (filterUIEvents) {
      filteredEvents = allCachedEvents.filter(event => {
        const payload = event.payload as { payload?: { type?: string } };
        return payload?.payload?.type === 'ui_tree';
      });
    }

    // Apply pagination
    const paginatedEvents = filteredEvents.slice(offset, offset + limit);
    const hasMore = filteredEvents.length > offset + limit;

    return {
      events: paginatedEvents,
      hasMore,
      totalCached: filteredEvents.length
    };
  }

  /**
   * Check if we have cached data for this user
   */
  async hasCachedData(): Promise<boolean> {
    try {
      await this.init();
      const info = await this.storage.getStorageInfo();
      return info.eventCount > 0;
    } catch (error) {
      console.error('[SharedEventsStorage] Error checking cached data:', error);
      return false;
    }
  }

  /**
   * Get storage information
   */
  async getStorageInfo() {
    await this.init();
    return this.storage.getStorageInfo();
  }

  /**
   * Save events to cache (typically called by raw events tab)
   */
  async saveEvents(events: LowLevelEvent[]): Promise<void> {
    await this.init();
    await this.storage.saveEvents(events);
  }

  /**
   * Get a specific event by ID
   */
  async getEventById(id: number): Promise<LowLevelEvent | null> {
    await this.init();
    return this.storage.getEventById(id);
  }

  /**
   * Clear all cached data
   */
  async clearCache(): Promise<void> {
    await this.init();
    await this.storage.clearAllEvents();
  }
}

// Singleton instances per user to avoid multiple DB connections
const sharedStorageInstances = new Map<string, SharedEventsStorage>();

export const getSharedEventsStorage = (userId: string): SharedEventsStorage => {
  if (!sharedStorageInstances.has(userId)) {
    sharedStorageInstances.set(userId, new SharedEventsStorage(userId));
  }
  return sharedStorageInstances.get(userId)!;
};

/**
 * Hook for React components to easily access shared storage
 */
export const useSharedEventsStorage = (userId: string) => {
  const storage = getSharedEventsStorage(userId);
  
  return {
    storage,
    getCachedEvents: storage.getCachedEvents.bind(storage),
    hasCachedData: storage.hasCachedData.bind(storage),
    getStorageInfo: storage.getStorageInfo.bind(storage),
    getEventById: storage.getEventById.bind(storage),
    clearCache: storage.clearCache.bind(storage),
  };
};