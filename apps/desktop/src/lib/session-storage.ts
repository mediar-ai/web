/**
 * Utility functions for managing AI session storage using IndexedDB
 * IndexedDB has virtually unlimited storage (50%+ of disk) vs localStorage's ~5MB
 * Sessions are stored per-workflow to maintain conversation context
 */

const DB_NAME = "mediar_sessions";
const DB_VERSION = 2; // Bumped for sessions_index store
const MESSAGES_STORE = "messages";
const SETTINGS_STORE = "settings";
const SESSIONS_INDEX_STORE = "sessions_index"; // Metadata for all sessions

// Global session key for single-conversation mode (no per-workflow sessions)
const GLOBAL_SESSION_KEY = "global";

// Legacy localStorage prefixes (for migration)
const MESSAGES_STORAGE_PREFIX = "mediar_ai_messages:";
const MODE_STORAGE_PREFIX = "mediar_ai_mode:";
const SESSION_STORAGE_PREFIX = "mediar_ai_session:";

// Cached DB connection
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open or get cached IndexedDB connection
 */
function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[SESSION-STORAGE] Failed to open IndexedDB:", request.error);
      dbPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create messages store (keyed by sessionId)
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        db.createObjectStore(MESSAGES_STORE);
      }

      // Create settings store for mode, sessionId, etc.
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }

      // Create sessions index store for session metadata (v2)
      if (!db.objectStoreNames.contains(SESSIONS_INDEX_STORE)) {
        db.createObjectStore(SESSIONS_INDEX_STORE);
      }
    };
  });

  return dbPromise;
}

/**
 * Generic get from IndexedDB
 */
async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const request = tx.objectStore(store).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  });
}

/**
 * Generic set to IndexedDB
 */
async function dbSet(store: string, key: string, value: any): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const request = tx.objectStore(store).put(value, key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Generic delete from IndexedDB
 */
async function dbDelete(store: string, key: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const request = tx.objectStore(store).delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// In-memory cache for sync access
const messagesCache = new Map<string, any[]>();

/**
 * Clear session for a specific workflow
 */
export function clearWorkflowSession(workflowId: string): void {
  dbDelete(SETTINGS_STORE, `session:${workflowId}`)
    .then(() => console.log(`[SESSION-STORAGE] Cleared session for workflow: ${workflowId}`))
    .catch(error => console.error("[SESSION-STORAGE] Failed to clear session:", error));
}

/**
 * Get conversation messages for a specific workflow (async)
 */
export async function getWorkflowMessagesAsync(workflowId: string): Promise<any[]> {
  try {
    const messages = await dbGet<any[]>(MESSAGES_STORE, workflowId);
    if (!messages || messages.length === 0) {
      return [];
    }
    console.log(`[SESSION-STORAGE] Loaded ${messages.length} messages for workflow ${workflowId}`);
    return messages;
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to get messages:", error);
    return [];
  }
}

/**
 * Get conversation messages for a specific workflow (sync - for backwards compatibility)
 * Returns cached value or empty array, triggers async load
 */
export function getWorkflowMessages(workflowId: string): any[] {
  // Return cached value if available
  if (messagesCache.has(workflowId)) {
    const messages = messagesCache.get(workflowId)!;
    console.log(`[SESSION-STORAGE] Loaded ${messages.length} messages from cache for workflow ${workflowId}`);
    return messages;
  }

  // Try localStorage fallback for migration
  try {
    const key = `${MESSAGES_STORAGE_PREFIX}${workflowId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      const messages = JSON.parse(stored);
      console.log(`[SESSION-STORAGE] Migrating ${messages.length} messages from localStorage to IndexedDB`);
      // Cache and migrate to IndexedDB
      messagesCache.set(workflowId, messages);
      setWorkflowMessages(workflowId, messages);
      // Clear from localStorage after migration
      localStorage.removeItem(key);
      return messages;
    }
  } catch (e) {
    // Ignore localStorage errors
  }

  // Trigger async load for next time
  getWorkflowMessagesAsync(workflowId).then(messages => {
    if (messages.length > 0) {
      messagesCache.set(workflowId, messages);
    }
  });

  return [];
}

/**
 * Preload messages for a workflow (call this early to warm the cache)
 */
export async function preloadWorkflowMessages(workflowId: string): Promise<any[]> {
  const messages = await getWorkflowMessagesAsync(workflowId);
  if (messages.length > 0) {
    messagesCache.set(workflowId, messages);
  }
  return messages;
}

/**
 * Save conversation messages for a specific workflow
 */
export function setWorkflowMessages(workflowId: string, messages: any[]): void {
  // Update cache immediately
  messagesCache.set(workflowId, messages);

  // Save to IndexedDB async
  dbSet(MESSAGES_STORE, workflowId, messages)
    .then(() => {
      const sizeKB = (JSON.stringify(messages).length / 1024).toFixed(2);
      console.log(`[SESSION-STORAGE] Saved ${messages.length} messages (${sizeKB} KB) for workflow ${workflowId}`);
    })
    .catch(error => {
      console.error("[SESSION-STORAGE] Failed to save messages:", error);
    });
}

/**
 * Clear conversation messages for a specific workflow
 */
export function clearWorkflowMessages(workflowId: string): void {
  messagesCache.delete(workflowId);
  dbDelete(MESSAGES_STORE, workflowId)
    .then(() => console.log(`[SESSION-STORAGE] Cleared messages for workflow ${workflowId}`))
    .catch(error => console.error("[SESSION-STORAGE] Failed to clear messages:", error));
}

/**
 * Get chat mode for a specific workflow
 */
export function getWorkflowMode(workflowId: string): "ask" | "act" | "x" | "recorder" | "homepage" | null {
  // Mode is small, keep in localStorage for sync access
  try {
    const key = `${MODE_STORAGE_PREFIX}${workflowId}`;
    const stored = localStorage.getItem(key);
    if (stored === "ask" || stored === "act" || stored === "x" || stored === "recorder" || stored === "homepage") {
      return stored;
    }
    return null;
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to get mode:", error);
    return null;
  }
}

/**
 * Save chat mode for a specific workflow
 */
export function setWorkflowMode(workflowId: string, mode: "ask" | "act" | "x" | "recorder" | "homepage"): void {
  try {
    const key = `${MODE_STORAGE_PREFIX}${workflowId}`;
    localStorage.setItem(key, mode);
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to save mode:", error);
  }
}

// =============================================================================
// Global Session Functions (single conversation per user)
// =============================================================================

/**
 * Get global conversation messages (single session for all contexts)
 */
export function getGlobalMessages(): any[] {
  return getWorkflowMessages(GLOBAL_SESSION_KEY);
}

/**
 * Get global conversation messages async (for initial load)
 */
export async function getGlobalMessagesAsync(): Promise<any[]> {
  return getWorkflowMessagesAsync(GLOBAL_SESSION_KEY);
}

/**
 * Preload global messages (call this early to warm the cache)
 */
export async function preloadGlobalMessages(): Promise<any[]> {
  return preloadWorkflowMessages(GLOBAL_SESSION_KEY);
}

/**
 * Save global conversation messages
 */
export function setGlobalMessages(messages: any[]): void {
  setWorkflowMessages(GLOBAL_SESSION_KEY, messages);
}

/**
 * Get global chat mode
 */
export function getGlobalMode(): "ask" | "act" | "x" | "recorder" | "homepage" | null {
  return getWorkflowMode(GLOBAL_SESSION_KEY);
}

/**
 * Set global chat mode
 */
export function setGlobalMode(mode: "ask" | "act" | "x" | "recorder" | "homepage"): void {
  setWorkflowMode(GLOBAL_SESSION_KEY, mode);
}

/**
 * Clear global session
 */
export function clearGlobalSession(): void {
  clearWorkflowMessages(GLOBAL_SESSION_KEY);
}

// =============================================================================
// Session History Functions (IndexedDB-first history)
// =============================================================================

/**
 * Metadata for a chat session stored in IndexedDB
 */
export interface LocalSessionMetadata {
  sessionId: string; // Redis session ID (primary key)
  title: string | null;
  messageCount: number;
  workflowId: string | null; // null for global/homepage sessions
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

// In-memory cache for sessions list
let sessionsCache: LocalSessionMetadata[] | null = null;

/**
 * Save or update session metadata in IndexedDB
 */
export async function saveSessionMetadata(metadata: LocalSessionMetadata): Promise<void> {
  try {
    await dbSet(SESSIONS_INDEX_STORE, metadata.sessionId, metadata);
    // Invalidate cache
    sessionsCache = null;
    console.log(
      `[SESSION-STORAGE] Saved session metadata: ${metadata.sessionId}, "${metadata.title?.slice(0, 30)}..."`
    );
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to save session metadata:", error);
  }
}

/**
 * Get session metadata by session ID
 */
export async function getSessionMetadata(sessionId: string): Promise<LocalSessionMetadata | null> {
  try {
    const metadata = await dbGet<LocalSessionMetadata>(SESSIONS_INDEX_STORE, sessionId);
    return metadata || null;
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to get session metadata:", error);
    return null;
  }
}

/**
 * List all local sessions from IndexedDB, sorted by updatedAt desc
 */
export async function listAllLocalSessions(): Promise<LocalSessionMetadata[]> {
  // Return cache if available
  if (sessionsCache) {
    return sessionsCache;
  }

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSIONS_INDEX_STORE, "readonly");
      const store = tx.objectStore(SESSIONS_INDEX_STORE);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const sessions = (request.result as LocalSessionMetadata[]) || [];
        // Sort by updatedAt descending (most recent first)
        sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        // Cache the result
        sessionsCache = sessions;
        console.log(`[SESSION-STORAGE] Listed ${sessions.length} local sessions`);
        resolve(sessions);
      };
    });
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to list local sessions:", error);
    return [];
  }
}

/**
 * Delete session metadata and messages from IndexedDB
 */
export async function deleteLocalSession(sessionId: string): Promise<void> {
  try {
    await dbDelete(SESSIONS_INDEX_STORE, sessionId);
    await dbDelete(MESSAGES_STORE, sessionId);
    messagesCache.delete(sessionId);
    // Invalidate sessions cache
    sessionsCache = null;
    console.log(`[SESSION-STORAGE] Deleted local session: ${sessionId}`);
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to delete local session:", error);
  }
}

/**
 * Get messages for a specific session by sessionId
 */
export async function getSessionMessages(sessionId: string): Promise<any[]> {
  return getWorkflowMessagesAsync(sessionId);
}

/**
 * Debug: List all keys in the messages store
 */
export async function debugListMessageKeys(): Promise<string[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, "readonly");
      const store = tx.objectStore(MESSAGES_STORE);
      const request = store.getAllKeys();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const keys = request.result as string[];
        console.log(`[SESSION-STORAGE] All message keys:`, keys);
        resolve(keys);
      };
    });
  } catch (error) {
    console.error("[SESSION-STORAGE] Failed to list message keys:", error);
    return [];
  }
}

/**
 * Save messages for a specific session by sessionId
 */
export function saveSessionMessages(sessionId: string, messages: any[]): void {
  setWorkflowMessages(sessionId, messages);
}
