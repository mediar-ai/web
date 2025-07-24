import type { LowLevelEvent } from '@/types';
import type { 
  WorkflowStepAnalysis, 
  DatasetEntry, 
  LabelingStorageInfo, 
  UnifiedLabelingData 
} from '@/types/shared-data-management';

// Configuration constants
const DB_NAME = 'UnifiedLabelingDB';
const DB_VERSION = 1;
const EVENTS_STORE = 'events';
const ANALYSES_STORE = 'analyses';
const ANNOTATIONS_STORE = 'annotations';
const METADATA_STORE = 'metadata';

// Storage quotas (300MB total)
const MAX_TOTAL_SIZE = 300 * 1024 * 1024; // 300MB
const EVENTS_QUOTA = 150 * 1024 * 1024;   // 150MB for events
const ANALYSES_QUOTA = 100 * 1024 * 1024; // 100MB for analyses  
const ANNOTATIONS_QUOTA = 50 * 1024 * 1024; // 50MB for annotations

const CLEANUP_THRESHOLD = 0.9; // Start cleanup at 90% capacity
const CLEANUP_TARGET = 0.7;    // Clean down to 70% capacity

interface StorageMetadata {
  id: string;
  totalSize: number;
  eventsSize: number;
  analysesSize: number;
  annotationsSize: number;
  eventCount: number;
  analysisCount: number;
  annotationCount: number;
  lastUpdated: number;
}

export class UnifiedLabelingStorage {
  private db: IDBDatabase | null = null;
  private userId: string;
  private dbName: string;

  constructor(userId: string) {
    this.userId = userId;
    this.dbName = `${DB_NAME}_${userId}`;
  }

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Events store (filtered UI tree events for context)
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          const eventsStore = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
          eventsStore.createIndex('userId', 'user_id', { unique: false });
          eventsStore.createIndex('createdAt', 'created_at', { unique: false });
          eventsStore.createIndex('sessionId', 'session_id', { unique: false });
          eventsStore.createIndex('eventType', 'event_type', { unique: false });
        }

        // Analyses store (workflow step analyses)
        if (!db.objectStoreNames.contains(ANALYSES_STORE)) {
          const analysesStore = db.createObjectStore(ANALYSES_STORE, { keyPath: 'id' });
          analysesStore.createIndex('userId', 'user_id', { unique: false });
          analysesStore.createIndex('clientTimestamp', 'client_timestamp', { unique: false });
          analysesStore.createIndex('createdAt', 'created_at', { unique: false });
          analysesStore.createIndex('sessionId', 'session_id', { unique: false });
        }

        // Annotations store (dataset entries/feedback)
        if (!db.objectStoreNames.contains(ANNOTATIONS_STORE)) {
          const annotationsStore = db.createObjectStore(ANNOTATIONS_STORE, { keyPath: 'id' });
          annotationsStore.createIndex('userId', 'user_id', { unique: false });
          annotationsStore.createIndex('analysisId', 'low_level_workflow_analysis_id', { unique: false });
          annotationsStore.createIndex('feedback', 'feedback', { unique: false });
          annotationsStore.createIndex('createdAt', 'created_at', { unique: false });
        }

        // Metadata store for storage tracking
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  // Utility methods for IndexedDB operations
  private getFromStore<T>(store: IDBObjectStore, key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  private putToStore<T>(store: IDBObjectStore, data: T): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = store.put(data);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // Size estimation methods
  private estimateEventSize(event: LowLevelEvent): number {
    return JSON.stringify(event).length * 2; // Factor of 2 for safety
  }

  private estimateAnalysisSize(analysis: WorkflowStepAnalysis): number {
    return JSON.stringify(analysis).length * 2; // Analyses are typically larger
  }

  private estimateAnnotationSize(annotation: DatasetEntry): number {
    return JSON.stringify(annotation).length * 2;
  }

  // Storage metadata management
  private async getStorageMetadata(): Promise<StorageMetadata | null> {
    if (!this.db) return null;

    const transaction = this.db.transaction([METADATA_STORE], 'readonly');
    const store = transaction.objectStore(METADATA_STORE);
    return this.getFromStore<StorageMetadata>(store, `storage_${this.userId}`);
  }

  private async updateStorageMetadata(
    eventsDelta: number = 0, 
    eventsCountDelta: number = 0,
    analysesDelta: number = 0, 
    analysesCountDelta: number = 0,
    annotationsDelta: number = 0, 
    annotationsCountDelta: number = 0
  ): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([METADATA_STORE], 'readwrite');
    const store = transaction.objectStore(METADATA_STORE);
    
    const metadataKey = `storage_${this.userId}`;
    const existing = await this.getFromStore<StorageMetadata>(store, metadataKey);
    
    const metadata: StorageMetadata = {
      id: metadataKey,
      totalSize: (existing?.totalSize || 0) + eventsDelta + analysesDelta + annotationsDelta,
      eventsSize: (existing?.eventsSize || 0) + eventsDelta,
      analysesSize: (existing?.analysesSize || 0) + analysesDelta,
      annotationsSize: (existing?.annotationsSize || 0) + annotationsDelta,
      eventCount: (existing?.eventCount || 0) + eventsCountDelta,
      analysisCount: (existing?.analysisCount || 0) + analysesCountDelta,
      annotationCount: (existing?.annotationCount || 0) + annotationsCountDelta,
      lastUpdated: Date.now(),
    };

    await this.putToStore(store, metadata);
  }

  // Save methods for each data type
  async saveEvents(events: LowLevelEvent[]): Promise<void> {
    if (!events.length) return;
    
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const existingIds = new Set(await this.getEventIds());
    const newEvents = events.filter(event => !existingIds.has(event.id));
    
    if (newEvents.length === 0) return;

    // Calculate size impact
    const sizeIncrease = newEvents.reduce((sum, event) => sum + this.estimateEventSize(event), 0);
    
    // Check quota and cleanup if needed
    const metadata = await this.getStorageMetadata();
    if (metadata && metadata.eventsSize + sizeIncrease > EVENTS_QUOTA) {
      await this.cleanupEvents();
    }

    const transaction = this.db.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
    const eventsStore = transaction.objectStore(EVENTS_STORE);
    
    // Save events
    for (const event of newEvents) {
      await this.putToStore(eventsStore, event);
    }

    // Update metadata
    await this.updateStorageMetadata(sizeIncrease, newEvents.length, 0, 0, 0, 0);
    
    console.log(`[UnifiedStorage] Saved ${newEvents.length} events`);
  }

  async saveAnalyses(analyses: WorkflowStepAnalysis[]): Promise<void> {
    if (!analyses.length) return;
    
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const existingIds = new Set(await this.getAnalysisIds());
    const newAnalyses = analyses.filter(analysis => !existingIds.has(analysis.id));
    
    if (newAnalyses.length === 0) return;

    // Calculate size impact
    const sizeIncrease = newAnalyses.reduce((sum, analysis) => sum + this.estimateAnalysisSize(analysis), 0);
    
    // Check quota and cleanup if needed
    const metadata = await this.getStorageMetadata();
    if (metadata && metadata.analysesSize + sizeIncrease > ANALYSES_QUOTA) {
      await this.cleanupAnalyses();
    }

    const transaction = this.db.transaction([ANALYSES_STORE, METADATA_STORE], 'readwrite');
    const analysesStore = transaction.objectStore(ANALYSES_STORE);
    
    // Save analyses
    for (const analysis of newAnalyses) {
      await this.putToStore(analysesStore, analysis);
    }

    // Update metadata
    await this.updateStorageMetadata(0, 0, sizeIncrease, newAnalyses.length, 0, 0);
    
    console.log(`[UnifiedStorage] Saved ${newAnalyses.length} analyses`);
  }

  async saveAnnotations(annotations: DatasetEntry[]): Promise<void> {
    if (!annotations.length) return;
    
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // For annotations, we might want to update existing ones
    const transaction = this.db.transaction([ANNOTATIONS_STORE, METADATA_STORE], 'readwrite');
    const annotationsStore = transaction.objectStore(ANNOTATIONS_STORE);
    
    let sizeIncrease = 0;
    let newCount = 0;
    
    for (const annotation of annotations) {
      const existing = await this.getFromStore<DatasetEntry>(annotationsStore, annotation.id);
      if (!existing) {
        newCount++;
      }
      sizeIncrease += this.estimateAnnotationSize(annotation);
      await this.putToStore(annotationsStore, annotation);
    }

    // Update metadata
    await this.updateStorageMetadata(0, 0, 0, 0, sizeIncrease, newCount);
    
    console.log(`[UnifiedStorage] Saved ${annotations.length} annotations (${newCount} new)`);
  }

  // Convenience method to save all data types at once
  async saveAllData(data: UnifiedLabelingData): Promise<void> {
    await Promise.all([
      this.saveEvents(data.events),
      this.saveAnalyses(data.analyses),
      this.saveAnnotations(data.annotations)
    ]);
  }

  // Retrieval methods
  async getEventIds(): Promise<number[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    const index = store.index('userId');

    return new Promise((resolve, reject) => {
      const request = index.getAllKeys(this.userId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as number[]);
    });
  }

  async getAnalysisIds(): Promise<string[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([ANALYSES_STORE], 'readonly');
    const store = transaction.objectStore(ANALYSES_STORE);
    const index = store.index('userId');

    return new Promise((resolve, reject) => {
      const request = index.getAllKeys(this.userId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as string[]);
    });
  }

  async getEventsSortedByDate(limit: number = 1000): Promise<LowLevelEvent[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    const index = store.index('createdAt');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev'); // Newest first
      const results: LowLevelEvent[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor && results.length < limit) {
          const eventData = cursor.value as LowLevelEvent;
          if (eventData.user_id === this.userId) {
            results.push(eventData);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  }

  async getAnalysesSortedByDate(limit: number = 1000): Promise<WorkflowStepAnalysis[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([ANALYSES_STORE], 'readonly');
    const store = transaction.objectStore(ANALYSES_STORE);
    const index = store.index('clientTimestamp');

    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev'); // Newest first
      const results: WorkflowStepAnalysis[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        
        if (cursor && results.length < limit) {
          const analysisData = cursor.value as WorkflowStepAnalysis;
          if (analysisData.user_id === this.userId) {
            results.push(analysisData);
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  }

  async getAnnotationsByAnalysisId(analysisId: string): Promise<DatasetEntry | null> {
    if (!this.db) return null;

    const transaction = this.db.transaction([ANNOTATIONS_STORE], 'readonly');
    const store = transaction.objectStore(ANNOTATIONS_STORE);
    const index = store.index('analysisId');

    return new Promise((resolve, reject) => {
      const request = index.get(analysisId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  async getAllAnnotations(): Promise<DatasetEntry[]> {
    if (!this.db) return [];

    const transaction = this.db.transaction([ANNOTATIONS_STORE], 'readonly');
    const store = transaction.objectStore(ANNOTATIONS_STORE);
    const index = store.index('userId');

    return new Promise((resolve, reject) => {
      const request = index.getAll(this.userId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  // Storage info method
  async getStorageInfo(): Promise<LabelingStorageInfo> {
    await this.init();
    
    const metadata = await this.getStorageMetadata() || {
      id: `storage_${this.userId}`,
      totalSize: 0,
      eventsSize: 0,
      analysesSize: 0,
      annotationsSize: 0,
      eventCount: 0,
      analysisCount: 0,
      annotationCount: 0,
      lastUpdated: Date.now()
    };

    return {
      totalSize: metadata.totalSize,
      maxSize: MAX_TOTAL_SIZE,
      usagePercentage: (metadata.totalSize / MAX_TOTAL_SIZE) * 100,
      
      eventCount: metadata.eventCount,
      eventsSize: metadata.eventsSize,
      eventsUsagePercentage: (metadata.eventsSize / EVENTS_QUOTA) * 100,
      
      analysisCount: metadata.analysisCount,
      analysesSize: metadata.analysesSize,
      analysesUsagePercentage: (metadata.analysesSize / ANALYSES_QUOTA) * 100,
      
      annotationCount: metadata.annotationCount,
      annotationsSize: metadata.annotationsSize,
      annotationsUsagePercentage: (metadata.annotationsSize / ANNOTATIONS_QUOTA) * 100,
      
      lastUpdated: new Date(metadata.lastUpdated)
    };
  }

  // Cleanup methods
  private async cleanupEvents(): Promise<void> {
    if (!this.db) return;
    
    console.log('[UnifiedStorage] Starting events cleanup...');
    
    const metadata = await this.getStorageMetadata();
    if (!metadata || metadata.eventsSize < EVENTS_QUOTA * CLEANUP_THRESHOLD) {
      return; // No cleanup needed yet
    }
    
    const events = await this.getEventsSortedByDate(10000);
    const targetRemoveCount = Math.floor(events.length * (1 - CLEANUP_TARGET));
    
    if (targetRemoveCount <= 0) return;
    
    const eventsToRemove = events.slice(-targetRemoveCount); // Remove oldest
    const sizeRemoved = eventsToRemove.reduce((sum, event) => sum + this.estimateEventSize(event), 0);
    
    const transaction = this.db.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
    const eventsStore = transaction.objectStore(EVENTS_STORE);
    
    for (const event of eventsToRemove) {
      eventsStore.delete(event.id);
    }
    
    await this.updateStorageMetadata(-sizeRemoved, -eventsToRemove.length, 0, 0, 0, 0);
    
    console.log(`[UnifiedStorage] Cleaned up ${eventsToRemove.length} events`);
  }

  private async cleanupAnalyses(): Promise<void> {
    if (!this.db) return;
    
    console.log('[UnifiedStorage] Starting analyses cleanup...');
    
    const metadata = await this.getStorageMetadata();
    if (!metadata || metadata.analysesSize < ANALYSES_QUOTA * CLEANUP_THRESHOLD) {
      return; // No cleanup needed yet
    }
    
    const analyses = await this.getAnalysesSortedByDate(10000);
    const targetRemoveCount = Math.floor(analyses.length * (1 - CLEANUP_TARGET));
    
    if (targetRemoveCount <= 0) return;
    
    const analysesToRemove = analyses.slice(-targetRemoveCount); // Remove oldest
    const sizeRemoved = analysesToRemove.reduce((sum, analysis) => sum + this.estimateAnalysisSize(analysis), 0);
    
    const transaction = this.db.transaction([ANALYSES_STORE, METADATA_STORE], 'readwrite');
    const analysesStore = transaction.objectStore(ANALYSES_STORE);
    
    for (const analysis of analysesToRemove) {
      analysesStore.delete(analysis.id);
    }
    
    await this.updateStorageMetadata(0, 0, -sizeRemoved, -analysesToRemove.length, 0, 0);
    
    console.log(`[UnifiedStorage] Cleaned up ${analysesToRemove.length} analyses`);
  }

  // Clear methods
  async clearAllStorage(): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([EVENTS_STORE, ANALYSES_STORE, ANNOTATIONS_STORE, METADATA_STORE], 'readwrite');
    
    await Promise.all([
      transaction.objectStore(EVENTS_STORE).clear(),
      transaction.objectStore(ANALYSES_STORE).clear(),
      transaction.objectStore(ANNOTATIONS_STORE).clear(),
      transaction.objectStore(METADATA_STORE).clear()
    ]);
    
    console.log('[UnifiedStorage] Cleared all storage');
  }

  async clearEventsOnly(): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([EVENTS_STORE, METADATA_STORE], 'readwrite');
    await transaction.objectStore(EVENTS_STORE).clear();
    
    // Reset events metadata
    await this.updateStorageMetadata(-999999999, -999999, 0, 0, 0, 0); // Large negative to reset
    
    console.log('[UnifiedStorage] Cleared events storage');
  }

  async clearAnalysesOnly(): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([ANALYSES_STORE, METADATA_STORE], 'readwrite');
    await transaction.objectStore(ANALYSES_STORE).clear();
    
    // Reset analyses metadata
    await this.updateStorageMetadata(0, 0, -999999999, -999999, 0, 0); // Large negative to reset
    
    console.log('[UnifiedStorage] Cleared analyses storage');
  }

  async clearAnnotationsOnly(): Promise<void> {
    if (!this.db) return;

    const transaction = this.db.transaction([ANNOTATIONS_STORE, METADATA_STORE], 'readwrite');
    await transaction.objectStore(ANNOTATIONS_STORE).clear();
    
    // Reset annotations metadata
    await this.updateStorageMetadata(0, 0, 0, 0, -999999999, -999999); // Large negative to reset
    
    console.log('[UnifiedStorage] Cleared annotations storage');
  }
}

// Singleton pattern to avoid multiple DB connections per user
const storageInstances = new Map<string, UnifiedLabelingStorage>();

export function getUnifiedLabelingStorage(userId: string): UnifiedLabelingStorage {
  if (!storageInstances.has(userId)) {
    storageInstances.set(userId, new UnifiedLabelingStorage(userId));
  }
  return storageInstances.get(userId)!;
} 