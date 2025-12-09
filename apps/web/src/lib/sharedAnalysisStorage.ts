import { FlattenedWorkflowAnalysis } from '@/types';

interface StorageInfo {
  analysisCount: number;
  estimatedSize: number;
  lastUpdated: Date | null;
}

class SharedAnalysisStorage {
  private dbName: string;
  private version = 1;
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  
  // Storage cap: 50MB for analyses (smaller than events since analyses are fewer but richer)
  private readonly MAX_STORAGE_SIZE = 50 * 1024 * 1024; // 50MB
  
  constructor(private userId: string) {
    this.dbName = `analysisStorage_${userId}`;
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
        
        // Create analyses store - mirrors low_level_workflow_analyses table
        if (!db.objectStoreNames.contains('analyses')) {
          const analysesStore = db.createObjectStore('analyses', { keyPath: 'id' });
          
          // Create indexes matching database columns
          analysesStore.createIndex('user_id', 'user_id', { unique: false });
          analysesStore.createIndex('session_id', 'session_id', { unique: false });
          analysesStore.createIndex('client_timestamp', 'client_timestamp', { unique: false });
          analysesStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // Create metadata store for storage info
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Get cached analyses with optional filtering and pagination
   */
  async getCachedAnalyses(limit: number = 300, offset: number = 0): Promise<{
    analyses: FlattenedWorkflowAnalysis[];
    hasMore: boolean;
    totalCached: number;
  }> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['analyses'], 'readonly');
      const store = transaction.objectStore('analyses');
      const index = store.index('created_at');
      
      // Get analyses in descending order (newest first) - matching API behavior
      const request = index.openCursor(null, 'prev');
      const analyses: FlattenedWorkflowAnalysis[] = [];
      let count = 0;
      let skipped = 0;

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor && analyses.length < limit) {
          if (skipped >= offset) {
            analyses.push(cursor.value);
          } else {
            skipped++;
          }
          count++;
          cursor.continue();
        } else {
          // Check if there are more analyses beyond this batch
          const hasMore = cursor !== null;
          resolve({
            analyses,
            hasMore,
            totalCached: count
          });
        }
      };

      request.onerror = () => reject(new Error('Failed to fetch cached analyses'));
    });
  }

  /**
   * Save analyses to IndexedDB (with size management)
   */
  async saveAnalyses(analyses: FlattenedWorkflowAnalysis[]): Promise<void> {
    if (!analyses.length) return;
    
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check storage size before saving
    const currentSize = await this.getEstimatedSize();
    const newDataSize = this.estimateAnalysesSize(analyses);
    
    if (currentSize + newDataSize > this.MAX_STORAGE_SIZE) {
      await this.cleanupOldAnalyses();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['analyses', 'metadata'], 'readwrite');
      const analysesStore = transaction.objectStore('analyses');
      
      // Save analyses
      analyses.forEach(analysis => {
        analysesStore.put(analysis);
      });

      // Update metadata
      const metadataStore = transaction.objectStore('metadata');
      metadataStore.put({
        key: 'lastUpdated',
        value: new Date().toISOString()
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to save analyses'));
    });
  }

  /**
   * Get specific analysis by client timestamp
   */
  async getAnalysisByTimestamp(clientTimestamp: string): Promise<FlattenedWorkflowAnalysis | null> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['analyses'], 'readonly');
      const store = transaction.objectStore('analyses');
      const index = store.index('client_timestamp');
      const request = index.get(clientTimestamp);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to fetch analysis'));
    });
  }

  /**
   * Get storage information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['analyses', 'metadata'], 'readonly');
      const analysesStore = transaction.objectStore('analyses');
      const metadataStore = transaction.objectStore('metadata');

      const countRequest = analysesStore.count();
      const lastUpdatedRequest = metadataStore.get('lastUpdated');
      
      let analysisCount = 0;
      let lastUpdated: Date | null = null;

      countRequest.onsuccess = () => {
        analysisCount = countRequest.result;
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
          analysisCount,
          estimatedSize,
          lastUpdated
        });
      };

      transaction.onerror = () => reject(new Error('Failed to get storage info'));
    });
  }

  /**
   * Clear all cached analyses
   */
  async clearCache(): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['analyses', 'metadata'], 'readwrite');
      const analysesStore = transaction.objectStore('analyses');
      const metadataStore = transaction.objectStore('metadata');

      analysesStore.clear();
      metadataStore.clear();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Failed to clear cache'));
    });
  }

  /**
   * Check if we have cached data
   */
  async hasCachedData(): Promise<boolean> {
    try {
      await this.init();
      const info = await this.getStorageInfo();
      return info.analysisCount > 0;
    } catch {
      return false;
    }
  }

  private async getEstimatedSize(): Promise<number> {
    // Rough estimation based on typical analysis size
    const info = await this.getStorageInfo();
    return info.analysisCount * 1024; // ~1KB per analysis (rough estimate)
  }

  private estimateAnalysesSize(analyses: FlattenedWorkflowAnalysis[]): number {
    return analyses.length * 1024; // ~1KB per analysis
  }

  private async cleanupOldAnalyses(): Promise<void> {
    // Remove oldest 25% of analyses to make room (LRU-style cleanup)
    const { analyses } = await this.getCachedAnalyses(1000, 0);
    const toDelete = Math.floor(analyses.length * 0.25);
    
    if (toDelete === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['analyses'], 'readwrite');
      const store = transaction.objectStore('analyses');
      
      // Delete oldest analyses (they're sorted newest first, so delete from the end)
      const oldestAnalyses = analyses.slice(-toDelete);
      oldestAnalyses.forEach(analysis => {
        store.delete(analysis.id);
      });

      transaction.oncomplete = () => {
        console.log(`[AnalysisStorage] Cleaned up ${toDelete} old analyses`);
        resolve();
      };
      transaction.onerror = () => reject(new Error('Failed to cleanup old analyses'));
    });
  }
}

// Singleton pattern to avoid multiple DB connections per user
const storageInstances = new Map<string, SharedAnalysisStorage>();

export function getSharedAnalysisStorage(userId: string): SharedAnalysisStorage {
  if (!storageInstances.has(userId)) {
    storageInstances.set(userId, new SharedAnalysisStorage(userId));
  }
  return storageInstances.get(userId)!;
}