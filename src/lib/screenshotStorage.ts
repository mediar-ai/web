/**
 * Load a screenshot from Supabase storage, with fallback to base64 data
 */
export async function loadScreenshotFromStorage(
  userId: string,
  sessionId: string,
  eventId: string | number,
  type: 'before' | 'after' | 'single' = 'single',
  fallbackDataUrl?: string | null
): Promise<string | null> {
  try {
    // Determine the storage path based on type
    let storagePath: string;
    
    if (type === 'single') {
      // For regular web screenshots: {userId}/{sessionId}/screenshots/{eventId}.jpeg
      storagePath = `${userId}/${sessionId}/screenshots/${eventId}.jpeg`;
    } else {
      // For background processor screenshots: {userId}/{sessionId}/screenshots/{eventId}_before.jpeg
      storagePath = `${userId}/${sessionId}/screenshots/${eventId}_${type}.jpeg`;
    }

    // Try to get a signed URL for the screenshot
    const response = await fetch('/api/capture/get-download-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: storagePath }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.signedUrl) {
        console.log(`[loadScreenshotFromStorage] Loaded from storage: ${storagePath}`);
        return data.signedUrl;
      }
    }

    // If storage loading failed, fall back to base64 data
    if (fallbackDataUrl) {
      console.log(`[loadScreenshotFromStorage] Storage not available, using fallback base64 data`);
      return fallbackDataUrl;
    }

    console.warn(`[loadScreenshotFromStorage] No screenshot available for ${storagePath}`);
    return null;

  } catch (error) {
    console.error(`[loadScreenshotFromStorage] Error loading screenshot:`, error);
    
    // Fall back to base64 data if available
    if (fallbackDataUrl) {
      console.log(`[loadScreenshotFromStorage] Error occurred, using fallback base64 data`);
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