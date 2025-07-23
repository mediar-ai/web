/**
 * Screenshot storage with IndexedDB caching and Supabase fallback
 */

interface CachedScreenshot {
  key: string; // userId_sessionId_eventId_type
  dataUrl: string; // base64 or signed URL
  timestamp: number; // when cached
  size: number; // estimated size in bytes
  isSignedUrl: boolean; // true if from Supabase, false if base64
  expiresAt?: number; // for signed URLs
}

interface ScreenshotStorageInfo {
  screenshotCount: number;
  estimatedSize: number;
  lastCleanup: Date | null;
}

class ScreenshotCache {
  private dbName = 'screenshotCache';
  private version = 1;
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  
  // 100MB cache for screenshots
  private readonly MAX_STORAGE_SIZE = 100 * 1024 * 1024;
  
  async init(): Promise<void> {
    if (this.isInitialized && this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(new Error('Failed to open screenshot cache'));
      
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains('screenshots')) {
          const store = db.createObjectStore('screenshots', { keyPath: 'key' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('size', 'size', { unique: false });
        }

        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  private getScreenshotKey(userId: string, sessionId: string, eventId: string | number, type: string): string {
    return `${userId}_${sessionId}_${eventId}_${type}`;
  }

  private estimateSize(dataUrl: string): number {
    return dataUrl.length * 0.75; // Rough base64 size estimation
  }

  async getCachedScreenshot(
    userId: string, 
    sessionId: string, 
    eventId: string | number, 
    type: string
  ): Promise<string | null> {
    try {
      await this.init();
      if (!this.db) return null;

      const key = this.getScreenshotKey(userId, sessionId, eventId, type);
      
      return new Promise((resolve) => {
        const transaction = this.db!.transaction(['screenshots'], 'readonly');
        const store = transaction.objectStore('screenshots');
        const request = store.get(key);

        request.onsuccess = () => {
          const cached = request.result as CachedScreenshot | undefined;
          if (!cached) {
            resolve(null);
            return;
          }

          // Check if signed URL has expired
          if (cached.isSignedUrl && cached.expiresAt && Date.now() > cached.expiresAt) {
            console.log(`[ScreenshotCache] Signed URL expired for ${key}`);
            this.deleteScreenshot(key); // Clean up expired URL
            resolve(null);
            return;
          }

          resolve(cached.dataUrl);
        };

        request.onerror = () => resolve(null);
      });
    } catch (error) {
      console.error('[ScreenshotCache] Error getting cached screenshot:', error);
      return null;
    }
  }

  async cacheScreenshot(
    userId: string,
    sessionId: string, 
    eventId: string | number,
    type: string,
    dataUrl: string,
    isSignedUrl: boolean = false
  ): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      const key = this.getScreenshotKey(userId, sessionId, eventId, type);
      const size = this.estimateSize(dataUrl);
      
      // Check storage size before adding
      const currentSize = await this.getEstimatedSize();
      if (currentSize + size > this.MAX_STORAGE_SIZE) {
        await this.cleanupOldScreenshots();
      }

      const cached: CachedScreenshot = {
        key,
        dataUrl,
        timestamp: Date.now(),
        size,
        isSignedUrl,
        expiresAt: isSignedUrl ? Date.now() + (6 * 60 * 60 * 1000) : undefined // 6 hours for signed URLs
      };

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction(['screenshots', 'metadata'], 'readwrite');
        const store = transaction.objectStore('screenshots');
        const metadataStore = transaction.objectStore('metadata');
        
        store.put(cached);
        metadataStore.put({
          key: 'lastUpdated',
          value: new Date().toISOString()
        });

        transaction.oncomplete = () => {
          console.log(`[ScreenshotCache] Cached screenshot ${key} (${(size/1024).toFixed(1)}KB)`);
          resolve();
        };
        transaction.onerror = () => reject(new Error('Failed to cache screenshot'));
      });
    } catch (error) {
      console.error('[ScreenshotCache] Error caching screenshot:', error);
    }
  }

  private async deleteScreenshot(key: string): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['screenshots'], 'readwrite');
      const store = transaction.objectStore('screenshots');
      store.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve(); // Don't fail on delete errors
    });
  }

  private async getEstimatedSize(): Promise<number> {
    try {
      await this.init();
      if (!this.db) return 0;

      return new Promise((resolve) => {
        const transaction = this.db!.transaction(['screenshots'], 'readonly');
        const store = transaction.objectStore('screenshots');
        const request = store.getAll();

        request.onsuccess = () => {
          const screenshots = request.result as CachedScreenshot[];
          const totalSize = screenshots.reduce((sum, s) => sum + s.size, 0);
          resolve(totalSize);
        };

        request.onerror = () => resolve(0);
      });
    } catch {
      return 0;
    }
  }

  private async cleanupOldScreenshots(): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      return new Promise((resolve) => {
        const transaction = this.db!.transaction(['screenshots'], 'readwrite');
        const store = transaction.objectStore('screenshots');
        const index = store.index('timestamp');
        const request = index.openCursor();
        
        const screenshots: CachedScreenshot[] = [];
        
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            screenshots.push(cursor.value);
            cursor.continue();
          } else {
            // Sort by timestamp (oldest first) and delete 30%
            screenshots.sort((a, b) => a.timestamp - b.timestamp);
            const toDelete = Math.floor(screenshots.length * 0.3);
            
            screenshots.slice(0, toDelete).forEach(screenshot => {
              store.delete(screenshot.key);
            });
            
            console.log(`[ScreenshotCache] Cleaned up ${toDelete} old screenshots`);
            resolve();
          }
        };

        request.onerror = () => resolve();
      });
    } catch (error) {
      console.error('[ScreenshotCache] Error during cleanup:', error);
    }
  }

  async getStorageInfo(): Promise<ScreenshotStorageInfo> {
    try {
      await this.init();
      if (!this.db) return { screenshotCount: 0, estimatedSize: 0, lastCleanup: null };

      return new Promise((resolve) => {
        const transaction = this.db!.transaction(['screenshots', 'metadata'], 'readonly');
        const store = transaction.objectStore('screenshots');
        const metadataStore = transaction.objectStore('metadata');
        
        const countRequest = store.count();
        const lastCleanupRequest = metadataStore.get('lastUpdated');
        
        let screenshotCount = 0;
        let lastCleanup: Date | null = null;

        countRequest.onsuccess = () => {
          screenshotCount = countRequest.result;
        };

        lastCleanupRequest.onsuccess = () => {
          const result = lastCleanupRequest.result;
          if (result?.value) {
            lastCleanup = new Date(result.value);
          }
        };

        transaction.oncomplete = async () => {
          const estimatedSize = await this.getEstimatedSize();
          resolve({ screenshotCount, estimatedSize, lastCleanup });
        };

        transaction.onerror = () => resolve({ screenshotCount: 0, estimatedSize: 0, lastCleanup: null });
      });
    } catch {
      return { screenshotCount: 0, estimatedSize: 0, lastCleanup: null };
    }
  }

  async clearCache(): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      return new Promise((resolve) => {
        const transaction = this.db!.transaction(['screenshots', 'metadata'], 'readwrite');
        const store = transaction.objectStore('screenshots');
        const metadataStore = transaction.objectStore('metadata');
        
        store.clear();
        metadataStore.clear();
        
        transaction.oncomplete = () => {
          console.log('[ScreenshotCache] Cache cleared');
          resolve();
        };
        transaction.onerror = () => resolve();
      });
    } catch (error) {
      console.error('[ScreenshotCache] Error clearing cache:', error);
    }
  }
}

// Global cache instance
const screenshotCache = new ScreenshotCache();

/**
 * Enhanced screenshot loading with IndexedDB caching
 */
export async function loadScreenshotFromStorage(
  userId: string,
  sessionId: string,
  eventId: string | number,
  type: 'before' | 'after' | 'single' = 'single',
  fallbackDataUrl?: string | null
): Promise<string | null> {
  try {
    // First, try to get from IndexedDB cache
    const cached = await screenshotCache.getCachedScreenshot(userId, sessionId, eventId, type);
    if (cached) {
      console.log(`[loadScreenshotFromStorage] Loaded from IndexedDB cache`);
      return cached;
    }

    // Determine the storage path based on type
    let storagePath: string;
    
    if (type === 'single') {
      storagePath = `${userId}/${sessionId}/screenshots/${eventId}.jpeg`;
    } else {
      storagePath = `${userId}/${sessionId}/screenshots/${eventId}_${type}.jpeg`;
    }

    // Try to get a signed URL from Supabase storage
    const response = await fetch('/api/capture/get-download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: storagePath }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.signedUrl) {
        console.log(`[loadScreenshotFromStorage] Loaded from Supabase storage: ${storagePath}`);
        
        // Cache the signed URL
        await screenshotCache.cacheScreenshot(userId, sessionId, eventId, type, data.signedUrl, true);
        
        return data.signedUrl;
      }
    }

    // If storage loading failed, fall back to base64 data and cache it
    if (fallbackDataUrl) {
      console.log(`[loadScreenshotFromStorage] Using fallback base64 data`);
      
      // Cache the base64 data
      await screenshotCache.cacheScreenshot(userId, sessionId, eventId, type, fallbackDataUrl, false);
      
      return fallbackDataUrl;
    }

    console.warn(`[loadScreenshotFromStorage] No screenshot available for ${storagePath}`);
    return null;

  } catch (error) {
    console.error(`[loadScreenshotFromStorage] Error loading screenshot:`, error);
    
    // Fall back to base64 data if available
    if (fallbackDataUrl) {
      console.log(`[loadScreenshotFromStorage] Error fallback to base64 data`);
      return fallbackDataUrl;
    }
    
    return null;
  }
}

/**
 * Load screenshots for a screenshot_diff event from storage with fallbacks
 */
export async function loadScreenshotDiffFromStorage(
  userId: string,
  sessionId: string,
  eventId: string | number,
  fallbackBeforeUrl?: string | null,
  fallbackAfterUrl?: string | null
): Promise<{ before: string | null; after: string | null }> {
  const [before, after] = await Promise.all([
    loadScreenshotFromStorage(userId, sessionId, eventId, 'before', fallbackBeforeUrl),
    loadScreenshotFromStorage(userId, sessionId, eventId, 'after', fallbackAfterUrl)
  ]);

  return { before, after };
}

/**
 * Check if a screenshot exists in storage
 */
export async function checkScreenshotInStorage(
  userId: string,
  sessionId: string,
  eventId: string | number,
  type: 'before' | 'after' | 'single' = 'single'
): Promise<boolean> {
  try {
    const storagePath = type === 'single' 
      ? `${userId}/${sessionId}/screenshots/${eventId}.jpeg`
      : `${userId}/${sessionId}/screenshots/${eventId}_${type}.jpeg`;

    const response = await fetch('/api/capture/get-download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: storagePath }),
    });

    return response.ok;
  } catch {
    return false;
  }
} 

// Export cache for storage info access
export { screenshotCache }; 