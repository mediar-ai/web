import type { LowLevelEvent } from '@/types';

// Configuration
const DB_NAME = 'RawEventsDB';
const DB_VERSION = 1;
const EVENTS_STORE = 'rawEvents';
const METADATA_STORE = 'metadata';
const MAX_STORAGE_SIZE = 500 * 1024 * 1024; // 500MB
const CLEANUP_THRESHOLD = 0.9; // Start cleanup at 90% capacity
const CLEANUP_TARGET = 0.7; // Clean down to 70% capacity

// EventMetadata interface removed as it was unused

interface StorageMetadata {
  id: string;
  totalSize: number;
  eventCount: number;
  lastCleanup: number;
}

export class RawEventsStorage {
  private db: IDBDatabase | null = null;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Events store
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          const eventsStore = db.createObjectStore(EVENTS_STORE, {
            keyPath: 'id',
          });
          eventsStore.createIndex('userId', 'user_id', { unique: false });
          eventsStore.createIndex('createdAt', 'created_at', { unique: false });
          eventsStore.createIndex('sessionId', 'session_id', { unique: false });
        }

        // Metadata store for size tracking
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  private estimateEventSize(event: LowLevelEvent): number {
    // Rough estimation: JSON stringify + some overhead
    return JSON.stringify(event).length * 2; // Factor of 2 for safety
  }

  private async updateStorageMetadata(sizeDelta: number, countDelta: number): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(METADATA_STORE);
    
    const metadataKey = `storage_${this.userId}`;
    const existing = await this.getFromStore<StorageMetadata>(store, metadataKey);
    
    const metadata: StorageMetadata = {
      id: metadataKey,
      totalSize: (existing?.totalSize || 0) + sizeDelta,
      eventCount: (existing?.eventCount || 0) + countDelta,
      lastCleanup: existing?.lastCleanup || Date.now(),
    };

    await this.putToStore(store, metadata);
  }

  private async getStorageMetadata(): Promise<StorageMetadata | null> {
    if (!this.db) return null;

    const transaction = this.db.transaction([METADATA_STORE], 'readonly');
    const store = transaction.objectStore(METADATA_STORE);
    return this.getFromStore<StorageMetadata>(store, `storage_${this.userId}`);
  }

  private async performCleanup(): Promise<void> {
    if (!this.db) return;

    console.log('[RawEventsStorage] Starting cleanup...');
    
    const metadata = await this.getStorageMetadata();
    if (!metadata || metadata.totalSize < MAX_STORAGE_SIZE * CLEANUP_THRESHOLD) {
      return;
    }

    const targetSize = MAX_STORAGE_SIZE * CLEANUP_TARGET;
    const sizeToRemove = metadata.totalSize - targetSize;

    // Get events sorted by created_at (oldest first)
    const events = await this.getEventsSortedByAge();
    
    let removedSize = 0;
    let removedCount = 0;
    const idsToDelete: number[] = [];

    for (const event of events) {
      if (removedSize >= sizeToRemove) break;
      
      const estimatedSize = this.estimateEventSize(event);
      idsToDelete.push(event.id);
      removedSize += estimatedSize;
      removedCount++;
    }

    if (idsToDelete.length > 0) {
      await this.deleteEventsById(idsToDelete);
      await this.updateStorageMetadata(-removedSize, -removedCount);
      
      console.log(`[RawEventsStorage] Cleanup completed: removed ${removedCount} events (${(removedSize / 1024 / 1024).toFixed(2)}MB)`);
    }
  }

  async getEventsSortedByAge(): Promise<LowLevelEvent[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    const index = store.index('createdAt');
    
    return new Promise((resolve, reject) => {
      const request = index.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const allEvents = request.result as LowLevelEvent[];
        const userEvents = allEvents.filter(event => event.user_id === this.userId);
        resolve(userEvents);
      };
    });
  }

  private async deleteEventsById(ids: number[]): Promise<void> {
    if (!this.db || ids.length === 0) return;

    const transaction = this.db.transaction([EVENTS_STORE], 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);

    const promises = ids.map(id => this.deleteFromStore(store, id));
    await Promise.all(promises);
  }

  async saveEvents(events: LowLevelEvent[]): Promise<void> {
    if (!this.db || events.length === 0) return;

    // Check if cleanup is needed before adding new events
    const metadata = await this.getStorageMetadata();
    if (metadata && metadata.totalSize > MAX_STORAGE_SIZE * CLEANUP_THRESHOLD) {
      await this.performCleanup();
    }

    const transaction = this.db.transaction([EVENTS_STORE], 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);

    // First, check which events already exist to avoid double-counting in metadata
    const existingEventIds = new Set<number>();
    for (const event of events) {
      try {
        const existing = await this.getFromStore<LowLevelEvent>(store, event.id);
        if (existing) {
          existingEventIds.add(event.id);
        }
      } catch {
        // Event doesn't exist, which is fine
      }
    }

    // Calculate only new events for metadata counting
    const newEvents = events.filter(event => !existingEventIds.has(event.id));
    const newEventsCount = newEvents.length;
    
    let totalSize = 0;
    const promises = events.map(event => {
      // Only count size for new events in metadata
      if (!existingEventIds.has(event.id)) {
        const size = this.estimateEventSize(event);
        totalSize += size;
      }
      return this.putToStore(store, event);
    });

    await Promise.all(promises);
    
    // Only update metadata with the count of actually new events
    if (newEventsCount > 0) {
      await this.updateStorageMetadata(totalSize, newEventsCount);
      console.log(`[RawEventsStorage] Saved ${events.length} events (${newEventsCount} new, ${existingEventIds.size} updated)`);
    } else {
      console.log(`[RawEventsStorage] Updated ${events.length} existing events (no new events)`);
    }
  }

  // Add method to recalculate metadata from actual stored data
  async recalculateMetadata(): Promise<void> {
    if (!this.db) return;

    console.log('[RawEventsStorage] Recalculating metadata from actual stored data...');
    
    // Get all events for this user
    const allEvents = await this.getEventsSortedByAge();
    
    // Calculate accurate totals
    let totalSize = 0;
    allEvents.forEach(event => {
      totalSize += this.estimateEventSize(event);
    });

    // Reset metadata to accurate values
    const transaction = this.db.transaction([METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(METADATA_STORE);
    
    const metadataKey = `storage_${this.userId}`;
    const metadata: StorageMetadata = {
      id: metadataKey,
      totalSize: totalSize,
      eventCount: allEvents.length,
      lastCleanup: Date.now(),
    };

    await this.putToStore(store, metadata);
    
    console.log(`[RawEventsStorage] Metadata recalculated: ${allEvents.length} events, ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
  }

  async loadEvents(limit: number = 1000, offset: number = 0): Promise<LowLevelEvent[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    const index = store.index('createdAt');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev'); // Newest first
      const results: LowLevelEvent[] = [];
      let skipped = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor && results.length < limit) {
          const eventData = cursor.value as LowLevelEvent;
          
          // Filter by userId
          if (eventData.user_id === this.userId) {
            if (skipped < offset) {
              skipped++;
            } else {
              results.push(eventData);
            }
          }
          
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  }

  async getEventById(id: number): Promise<LowLevelEvent | null> {
    if (!this.db) return null;

    const transaction = this.db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    return this.getFromStore<LowLevelEvent>(store, id);
  }

  async getStorageInfo(): Promise<{
    totalSize: number;
    eventCount: number;
    maxSize: number;
    usagePercentage: number;
  }> {
    const metadata = await this.getStorageMetadata();
    const totalSize = metadata?.totalSize || 0;
    const eventCount = metadata?.eventCount || 0;
    
    return {
      totalSize,
      eventCount,
      maxSize: MAX_STORAGE_SIZE,
      usagePercentage: (totalSize / MAX_STORAGE_SIZE) * 100,
    };
  }

  async clearAllEvents(): Promise<void> {
    if (!this.db) return;

    try {
      console.log('[RawEventsStorage] Starting to clear all events...');
      
      // First, get all events for this user (this creates its own transaction)
      const events = await this.getEventsSortedByAge();
      console.log(`[RawEventsStorage] Found ${events.length} events to delete`);

      if (events.length === 0) {
        // Still need to clear metadata even if no events
        const metadataTransaction = this.db.transaction([METADATA_STORE], 'readwrite');
        const metadataStore = metadataTransaction.objectStore(METADATA_STORE);
        await this.deleteFromStore(metadataStore, `storage_${this.userId}`);
        console.log('[RawEventsStorage] Cleared metadata (no events to delete)');
        return;
      }

      // Now create a new transaction to delete events and metadata
      const deleteTransaction = this.db.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
      const eventsStore = deleteTransaction.objectStore(EVENTS_STORE);
      const metadataStore = deleteTransaction.objectStore(METADATA_STORE);

      // Delete all events
      const deletePromises = events.map(event => this.deleteFromStore(eventsStore, event.id));
      await Promise.all(deletePromises);

      // Reset metadata
      await this.deleteFromStore(metadataStore, `storage_${this.userId}`);
      
      console.log(`[RawEventsStorage] Successfully cleared ${events.length} events and metadata`);
    } catch (error) {
      console.error('[RawEventsStorage] Failed to clear events:', error);
      throw error;
    }
  }

  /**
   * Nuclear option: completely delete the IndexedDB database
   * This handles cross-tab scenarios and corrupted transactions
   */
  async clearAll(): Promise<void> {
    try {
      console.log('[RawEventsStorage] Completely deleting IndexedDB database...');
      
      // Close current connection
      if (this.db) {
        this.db.close();
        this.db = null;
      }

      // Delete the entire database
      const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
      
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => {
          console.log('[RawEventsStorage] [SUCCESS] IndexedDB database completely deleted!');
          resolve();
        };
        deleteRequest.onerror = () => {
          console.error('[RawEventsStorage] [ERROR] Failed to delete IndexedDB:', deleteRequest.error);
          reject(deleteRequest.error);
        };
        deleteRequest.onblocked = () => {
          console.log('[RawEventsStorage] 🚫 Database deletion blocked - other tabs may be open');
          // Continue anyway after a short delay
          setTimeout(() => resolve(), 2000);
        };
      });

      // Reinitialize the database
      await this.init();
      
    } catch (error) {
      console.error('[RawEventsStorage] [ERROR] Error during complete database deletion:', error);
      throw error;
    }
  }

  // Helper methods for promise-based IndexedDB operations
  private getFromStore<T>(store: IDBObjectStore, key: string | number): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  private putToStore<T>(store: IDBObjectStore, value: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.put(value);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private deleteFromStore(store: IDBObjectStore, key: string | number): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

// Singleton instances per user
const storageInstances = new Map<string, RawEventsStorage>();

export const getRawEventsStorage = (userId: string): RawEventsStorage => {
  if (!storageInstances.has(userId)) {
    storageInstances.set(userId, new RawEventsStorage(userId));
  }
  return storageInstances.get(userId)!;
};