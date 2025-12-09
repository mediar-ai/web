// FlattenedWorkflowAnalysis import removed as it was unused

interface DatasetEntry {
  id: string; // analysis ID
  user_id: string;
  low_level_workflow_analysis_id: string;
  generated_output: string;
  feedback: 'good' | 'bad' | 'irrelevant' | null;
  feedback_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface DatasetStorageInfo {
  entryCount: number;
  estimatedSize: number;
  lastUpdated: Date | null;
}

class SharedDatasetStorage {
  private dbName: string;
  private version = 1;
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  
  // 25MB for dataset entries
  private readonly MAX_STORAGE_SIZE = 25 * 1024 * 1024;
  
  constructor(private userId: string) {
    this.dbName = `datasetStorage_${userId}`;
  }

  async init(): Promise<void> {
    if (this.isInitialized && this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(new Error('Failed to open IndexedDB'));
      
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create dataset entries store
        if (!db.objectStoreNames.contains('entries')) {
          const entriesStore = db.createObjectStore('entries', { keyPath: 'id' });
          
          // Create indexes matching dataset structure
          entriesStore.createIndex('user_id', 'user_id', { unique: false });
          entriesStore.createIndex('analysis_id', 'low_level_workflow_analysis_id', { unique: false });
          entriesStore.createIndex('feedback', 'feedback', { unique: false });
          entriesStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // Create metadata store
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Get cached dataset entries with optional filtering
   */
  async getCachedEntries(limit: number = 1000, offset: number = 0): Promise<{
    entries: DatasetEntry[];
    hasMore: boolean;
    totalCached: number;
  }> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries'], 'readonly');
      const store = transaction.objectStore('entries');
      const index = store.index('created_at');
      
      // Get entries in descending order (newest first)
      const request = index.openCursor(null, 'prev');
      const entries: DatasetEntry[] = [];
      let count = 0;
      let skipped = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && entries.length < limit) {
          if (skipped >= offset) {
            entries.push(cursor.value);
          } else {
            skipped++;
          }
          count++;
          cursor.continue();
        } else {
          const hasMore = cursor !== null;
          resolve({
            entries,
            hasMore,
            totalCached: count
          });
        }
      };

      request.onerror = () => reject(new Error('Failed to fetch cached entries'));
    });
  }

  /**
   * Save dataset entries to IndexedDB
   */
  async saveEntries(entries: DatasetEntry[]): Promise<void> {
    if (!entries.length) return;
    
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check storage size before saving
    const currentSize = await this.getEstimatedSize();
    const newDataSize = this.estimateEntriesSize(entries);
    
    if (currentSize + newDataSize > this.MAX_STORAGE_SIZE) {
      await this.cleanupOldEntries();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries', 'metadata'], 'readwrite');
      const entriesStore = transaction.objectStore('entries');
      
      // Save entries
      entries.forEach(entry => {
        entriesStore.put(entry);
      });

      // Update metadata
      const metadataStore = transaction.objectStore('metadata');
      metadataStore.put({
        key: 'lastUpdated',
        value: new Date().toISOString()
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to save entries'));
    });
  }

  /**
   * Save or update a single entry
   */
  async saveEntry(entry: DatasetEntry): Promise<void> {
    await this.saveEntries([entry]);
  }

  /**
   * Get specific entry by analysis ID
   */
  async getEntryByAnalysisId(analysisId: string): Promise<DatasetEntry | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries'], 'readonly');
      const store = transaction.objectStore('entries');
      const index = store.index('analysis_id');
      const request = index.get(analysisId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch entry'));
    });
  }

  /**
   * Delete entry by ID
   */
  async deleteEntry(entryId: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries'], 'readwrite');
      const store = transaction.objectStore('entries');
      const request = store.delete(entryId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to delete entry'));
    });
  }

  /**
   * Clear all entries
   */
  async clearEntries(): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries', 'metadata'], 'readwrite');
      const entriesStore = transaction.objectStore('entries');
      const metadataStore = transaction.objectStore('metadata');

      entriesStore.clear();
      metadataStore.clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to clear entries'));
    });
  }

  /**
   * Get storage information
   */
  async getStorageInfo(): Promise<DatasetStorageInfo> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries', 'metadata'], 'readonly');
      const entriesStore = transaction.objectStore('entries');
      const metadataStore = transaction.objectStore('metadata');

      const countRequest = entriesStore.count();
      const lastUpdatedRequest = metadataStore.get('lastUpdated');
      
      let entryCount = 0;
      let lastUpdated: Date | null = null;

      countRequest.onsuccess = () => {
        entryCount = countRequest.result;
      };

      lastUpdatedRequest.onsuccess = () => {
        const result = lastUpdatedRequest.result;
        if (result?.value) {
          lastUpdated = new Date(result.value);
        }
      };

      transaction.oncomplete = async () => {
        const estimatedSize = await this.getEstimatedSize();
        resolve({
          entryCount,
          estimatedSize,
          lastUpdated
        });
      };

      transaction.onerror = () => reject(new Error('Failed to get storage info'));
    });
  }

  /**
   * Check if we have cached data
   */
  async hasCachedData(): Promise<boolean> {
    try {
      await this.init();
      const info = await this.getStorageInfo();
      return info.entryCount > 0;
    } catch {
      return false;
    }
  }

  private async getEstimatedSize(): Promise<number> {
    const info = await this.getStorageInfo();
    return info.entryCount * 512; // ~0.5KB per entry (rough estimate)
  }

  private estimateEntriesSize(entries: DatasetEntry[]): number {
    return entries.length * 512; // ~0.5KB per entry
  }

  private async cleanupOldEntries(): Promise<void> {
    // Remove oldest 25% of entries to make room
    const { entries } = await this.getCachedEntries(1000, 0);
    const toDelete = Math.floor(entries.length * 0.25);
    
    if (toDelete === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['entries'], 'readwrite');
      const store = transaction.objectStore('entries');
      
      // Delete oldest entries (they're sorted newest first, so delete from the end)
      const oldestEntries = entries.slice(-toDelete);
      oldestEntries.forEach(entry => {
        store.delete(entry.id);
      });

      transaction.oncomplete = () => {
        console.log(`[DatasetStorage] Cleaned up ${toDelete} old entries`);
        resolve();
      };
      transaction.onerror = () => reject(new Error('Failed to cleanup old entries'));
    });
  }
}

// Singleton pattern to avoid multiple DB connections per user
const storageInstances = new Map<string, SharedDatasetStorage>();

export function getSharedDatasetStorage(userId: string): SharedDatasetStorage {
  if (!storageInstances.has(userId)) {
    storageInstances.set(userId, new SharedDatasetStorage(userId));
  }
  return storageInstances.get(userId)!;
}

export type { DatasetEntry, DatasetStorageInfo };