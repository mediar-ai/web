import type {
  Event,
  ParsedAnalysis,
  ScreenshotForExport,
  ActivityItem,
  InitialFrameDumpAnalysis,
  UIDiffAnalysis,
  RunningAnalysis,
} from '../types';

export interface Session {
  id: string;
  userId: string;
  type: 'low-level' | 'web';
  timestamp: string;
  eventCount: number;
  processed_event_count: number;
  status: 'live' | 'offline';
  duration_seconds: number | null;
  total_ui_steps?: number;
  total_workflow_analyses?: number;
  distinct_workflows_created?: number;
  total_labeled_steps?: number;
  llm_generated_labeled_steps?: number;
  llm_labeled_steps?: number;
  human_annotated_steps?: number;
}

export interface UserSessionData {
  name: string | null;
  organizationId: string | null;
  organizationName: string | null;
  workflowCount: number;
  sessions: Session[];
}

// IndexedDB utilities for persistence
export const DB_NAME = 'WorkflowCaptureDB';
export const DB_VERSION = 5; // Incremented for completed analyses store
export const WORKFLOW_STORE = 'workflowSteps';
export const LOGS_STORE = 'frontendLogs';
export const EVENTS_STORE = 'events';
export const SCREENSHOTS_STORE = 'screenshots';
export const ACTIVITY_ITEMS_STORE = 'activityItems'; // New store for activity items
export const COMPLETED_ANALYSES_STORE = 'completedAnalyses';
export const MAX_SCREENSHOTS = 50; // Keep only last 50 screenshots

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create workflow steps store
      if (!db.objectStoreNames.contains(WORKFLOW_STORE)) {
        const workflowStore = db.createObjectStore(WORKFLOW_STORE, {
          keyPath: 'id',
        });
        workflowStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create logs store
      if (!db.objectStoreNames.contains(LOGS_STORE)) {
        const logsStore = db.createObjectStore(LOGS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        logsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create events store
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const eventsStore = db.createObjectStore(EVENTS_STORE, {
          keyPath: 'id',
        });
        eventsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create screenshots store
      if (!db.objectStoreNames.contains(SCREENSHOTS_STORE)) {
        const screenshotsStore = db.createObjectStore(SCREENSHOTS_STORE, {
          keyPath: 'id',
        });
        screenshotsStore.createIndex('timestamp', 'timestamp', {
          unique: false,
        });
      }

      // Create activity items store
      if (!db.objectStoreNames.contains(ACTIVITY_ITEMS_STORE)) {
        db.createObjectStore(ACTIVITY_ITEMS_STORE, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(COMPLETED_ANALYSES_STORE)) {
        db.createObjectStore(COMPLETED_ANALYSES_STORE, { keyPath: 'id' });
      }
    };
  });
};

export const saveWorkflowSteps = async (
  steps: Array<
    {
      id: string;
      analysis: string;
      parsed: ParsedAnalysis | null;
      timestamp: string;
    }
  >,
) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([WORKFLOW_STORE], 'readwrite');
    const store = transaction.objectStore(WORKFLOW_STORE);

    await store.clear();
    for (const step of steps) {
      await store.add(step);
    }
  } catch (err) {
    console.error('[saveWorkflowSteps] Failed to save:', err);
  }
};

export const loadWorkflowSteps = async (): Promise<
  Array<
    {
      id: string;
      analysis: string;
      parsed: ParsedAnalysis | null;
      timestamp: string;
    }
  >
> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([WORKFLOW_STORE], 'readonly');
    const store = transaction.objectStore(WORKFLOW_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const steps = request.result || [];
        steps.sort((a, b) =>
          new Date(b.id).getTime() - new Date(a.id).getTime()
        );
        resolve(steps);
      };
    });
  } catch (err) {
    console.error('[loadWorkflowSteps] Failed to load:', err);
    return [];
  }
};

export const saveFrontendLogs = async (logs: string[]) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([LOGS_STORE], 'readwrite');
    const store = transaction.objectStore(LOGS_STORE);

    await store.clear();
    for (let i = 0; i < logs.length; i++) {
      await store.add({
        message: logs[i],
        timestamp: Date.now() - i, 
        index: i,
      });
    }
  } catch (err) {
    console.error('[saveFrontendLogs] Failed to save:', err);
  }
};

export const loadFrontendLogs = async (): Promise<string[]> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([LOGS_STORE], 'readonly');
    const store = transaction.objectStore(LOGS_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const logEntries = request.result || [];
        logEntries.sort((a, b) => a.index - b.index);
        resolve(logEntries.map((entry) => entry.message));
      };
    });
  } catch (err) {
    console.error('[loadFrontendLogs] Failed to load:', err);
    return [];
  }
};

export const clearPersistedData = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([
      WORKFLOW_STORE,
      LOGS_STORE,
      EVENTS_STORE,
      SCREENSHOTS_STORE,
      ACTIVITY_ITEMS_STORE,
      COMPLETED_ANALYSES_STORE,
    ], 'readwrite');
    await transaction.objectStore(WORKFLOW_STORE).clear();
    await transaction.objectStore(LOGS_STORE).clear();
    await transaction.objectStore(EVENTS_STORE).clear();
    await transaction.objectStore(SCREENSHOTS_STORE).clear();
    await transaction.objectStore(ACTIVITY_ITEMS_STORE).clear();
    await transaction.objectStore(COMPLETED_ANALYSES_STORE).clear();
  } catch (err) {
    console.error('[clearPersistedData] Failed to clear:', err);
  }
};

export const saveEvents = async (events: Array<Event>) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([EVENTS_STORE], 'readwrite');
    const store = transaction.objectStore(EVENTS_STORE);

    await store.clear();
    for (const event of events) {
      await store.add(event);
    }
  } catch (err) {
    console.error('[saveEvents] Failed to save:', err);
  }
};

export const loadEvents = async (): Promise<
  Array<{ id: string; summary: string; timestamp: string }>
> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([EVENTS_STORE], 'readonly');
    const store = transaction.objectStore(EVENTS_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const events = request.result || [];
        events.sort((a, b) => {
          const timeA = new Date(a.id.split('-change-')[0].split('-event')[0])
            .getTime();
          const timeB = new Date(b.id.split('-change-')[0].split('-event')[0])
            .getTime();
          return timeB - timeA;
        });
        resolve(events);
      };
    });
  } catch (err) {
    console.error('[loadEvents] Failed to load:', err);
    return [];
  }
};

export const compressCanvasToBlob = (
  canvas: HTMLCanvasElement,
  quality: number = 0.95,
): Promise<Blob> => {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob!);
      },
      'image/jpeg',
      quality,
    );
  });
};

export const saveScreenshot = async (id: string, canvas: HTMLCanvasElement) => {
  try {
    const db = await openDB();
    const blob = await compressCanvasToBlob(canvas);

    const screenshotData = {
      id,
      blob,
      timestamp: Date.now(),
      size: blob.size,
    };

    const transaction = db.transaction([SCREENSHOTS_STORE], 'readwrite');
    const store = transaction.objectStore(SCREENSHOTS_STORE);

    await store.add(screenshotData);

    const allRequest = store.getAll();
    const allScreenshots = await new Promise<
      { id: string; timestamp: number }[]
    >((resolve, reject) => {
      allRequest.onerror = () => reject(allRequest.error);
      allRequest.onsuccess = () => resolve(allRequest.result || []);
    });

    if (allScreenshots.length > MAX_SCREENSHOTS) {
      allScreenshots.sort((a, b) => a.timestamp - b.timestamp);
      const toDelete = allScreenshots.slice(
        0,
        allScreenshots.length - MAX_SCREENSHOTS,
      );

      for (const screenshot of toDelete) {
        await store.delete(screenshot.id);
      }
    }
  } catch (err) {
    console.error('[saveScreenshot] Failed to save:', err);
  }
};

export const getScreenshotById = async (
  id: string,
): Promise<Blob | null> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([SCREENSHOTS_STORE], 'readonly');
    const store = transaction.objectStore(SCREENSHOTS_STORE);
    const request = store.get(id);

    return new Promise((resolve, reject) => {
      request.onerror = () => {
        console.error(`[getScreenshotById] Error getting screenshot ${id}:`, request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.blob);
        } else {
          console.warn(`[getScreenshotById] Screenshot with id ${id} not found.`);
          resolve(null);
        }
      };
    });
  } catch (err) {
    console.error(`[getScreenshotById] Failed to get screenshot ${id}:`, err);
    return null;
  }
};

export const saveActivityItems = async (items: ActivityItem[]) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([ACTIVITY_ITEMS_STORE], 'readwrite');
    const store = transaction.objectStore(ACTIVITY_ITEMS_STORE);

    await store.clear();
    for (const item of items) {
      await store.add(item);
    }
  } catch (err) {
    console.error('[saveActivityItems] Failed to save:', err);
  }
};

export const loadActivityItems = async (): Promise<ActivityItem[]> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([ACTIVITY_ITEMS_STORE], 'readonly');
    const store = transaction.objectStore(ACTIVITY_ITEMS_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items = (request.result as ActivityItem[]) || [];
        items.sort((a, b) => {
          const idA = a.type === 'ui_diff' ? (a as UIDiffAnalysis).image2_id : (a as InitialFrameDumpAnalysis).image_id;
          const idB = b.type === 'ui_diff' ? (b as UIDiffAnalysis).image2_id : (b as InitialFrameDumpAnalysis).image_id;
          const timeA = idA
            ? new Date(
              idA.split('-diff')[0].split('-change-')[0].split('-event')[0],
            ).getTime()
            : 0;
          const timeB = idB
            ? new Date(
              idB.split('-diff')[0].split('-change-')[0].split('-event')[0],
            ).getTime()
            : 0;
          return timeB - timeA;
        });
        resolve(items);
      };
    });
  } catch (err) {
    console.error('[loadActivityItems] Failed to load:', err);
    return [];
  }
};

export const saveCompletedAnalyses = async (items: RunningAnalysis[]) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([COMPLETED_ANALYSES_STORE], 'readwrite');
    const store = transaction.objectStore(COMPLETED_ANALYSES_STORE);

    await store.clear();
    for (const item of items) {
      await store.add(item);
    }
  } catch (err) {
    console.error('[saveCompletedAnalyses] Failed to save:', err);
  }
};

export const loadCompletedAnalyses = async (): Promise<RunningAnalysis[]> => {
  try {
    const db = await openDB();
    const transaction = db.transaction([COMPLETED_ANALYSES_STORE], 'readonly');
    const store = transaction.objectStore(COMPLETED_ANALYSES_STORE);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const items = (request.result as RunningAnalysis[]) || [];
        items.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
        resolve(items);
      };
    });
  } catch (err) {
    console.error('[loadCompletedAnalyses] Failed to load:', err);
    return [];
  }
};

export const getAllPersistedDataForExport = async (): Promise<object> => {
  const db = await openDB();
  const transaction = db.transaction([
    WORKFLOW_STORE,
    LOGS_STORE,
    EVENTS_STORE,
    SCREENSHOTS_STORE,
    ACTIVITY_ITEMS_STORE,
    COMPLETED_ANALYSES_STORE,
  ], 'readonly');

  const workflowSteps = await new Promise<
    Array<
      {
        id: string;
        analysis: string;
        parsed: ParsedAnalysis | null;
        timestamp: string;
      }
    >
  >((resolve, reject) => {
    const request = transaction.objectStore(WORKFLOW_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  const frontendLogs = await new Promise<
    Array<{ message: string; timestamp: number; index: number }>
  >((resolve, reject) => {
    const request = transaction.objectStore(LOGS_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  const events = await new Promise<Event[]>((resolve, reject) => {
    const request = transaction.objectStore(EVENTS_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  const activityItems = await new Promise<ActivityItem[]>((resolve, reject) => {
    const request = transaction.objectStore(ACTIVITY_ITEMS_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  const completedAnalyses = await new Promise<RunningAnalysis[]>((resolve, reject) => {
    const request = transaction.objectStore(COMPLETED_ANALYSES_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  const screenshotsFromDB = await new Promise<
    Array<{ id: string; blob: Blob; timestamp: number; size: number }>
  >((resolve, reject) => {
    const request = transaction.objectStore(SCREENSHOTS_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });

  const screenshotsForExport: ScreenshotForExport[] = await Promise.all(
    screenshotsFromDB.map(async (ss) => {
      const dataUrl = await new Promise<string>((resolveBlob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolveBlob(reader.result as string);
        reader.readAsDataURL(ss.blob);
      });
      return {
        id: ss.id,
        dataUrl,
        timestamp: ss.timestamp,
        size: ss.size,
      };
    }),
  );

  return {
    workflowSteps,
    frontendLogs,
    events,
    activityItems,
    completedAnalyses,
    screenshots: screenshotsForExport,
    exportedAt: new Date().toISOString(),
  };
};

export const getSessions = async (): Promise<Record<string, UserSessionData>> => {
  try {
    const cacheBuster = `v=${Date.now()}`;
    const response = await fetch(`/api/sessions?${cacheBuster}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("[db.ts] Error fetching sessions:", error);
    return {};
  }
}; 