import type { DataProvider, ActivityItem, Event, RunningAnalysis, ParsedAnalysis } from '@/types';
import { 
  loadActivityItems as loadLocalActivityItems,
  loadEvents as loadLocalEvents,
  getScreenshotById,
  loadWorkflowSteps as loadLocalWorkflowSteps,
  loadCompletedAnalyses as loadLocalCompletedAnalyses
} from './db';

// This function is no longer needed as we are moving to signed URLs for downloads
// const constructScreenshotUrl = (userId: string, sessionId: string, imageId: string): string => {
//   const path = `${userId}/${sessionId}/screenshots/${imageId}.jpeg`;
//   const { data } = supabase.storage.from('low-level-event-screenshots').getPublicUrl(path);
//   return data.publicUrl;
// };

export const LocalDataProvider: DataProvider = {
  loadActivityItems: async () => loadLocalActivityItems(),
  loadEvents: async () => loadLocalEvents(),
  loadScreenshot: async (item: ActivityItem) => {
    const imageId = item.type === 'ui_diff' ? item.image2_id : item.image_id;
    if (!imageId) return null;
    return getScreenshotById(imageId);
  },
  loadWorkflowSteps: async () => loadLocalWorkflowSteps(),
  loadCompletedAnalyses: async () => loadLocalCompletedAnalyses(),
};

export class RemoteDataProvider implements DataProvider {
  private userId: string;
  private userName: string | null = null;
  private activityItems: ActivityItem[] | null = null;
  private events: Event[] | null = null;
  private completedAnalyses: RunningAnalysis[] | null = null;
  
  constructor(userId: string) {
    this.userId = userId;
  }
  
  private async fetchData(sessionId?: string) {
    // Only fetch if data hasn't been loaded yet - REMOVED CACHING LOGIC
    // if (this.activityItems !== null && this.events !== null && this.completedAnalyses !== null) {
    //   return;
    // }

    try {
      const cacheBuster = `cb=${Date.now()}`;
      const url = sessionId 
        ? `/api/users/${this.userId}/data?sessionId=${sessionId}&${cacheBuster}`
        : `/api/users/${this.userId}/data?${cacheBuster}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote data for user ${this.userId}`);
      }
      const data = await response.json();
      console.log('[RemoteDataProvider] Data received from API:', data);
      
      this.userName = data.userName;
      this.activityItems = data.activityItems || [];
      this.events = data.events || [];
      this.completedAnalyses = data.completedAnalyses || [];

    } catch (error) {
      console.error('[RemoteDataProvider] Error fetching data:', error);
      this.activityItems = [];
      this.events = [];
      this.completedAnalyses = [];
    }
  }

  getUserName(): string | null {
    return this.userName;
  }

  async loadActivityItems(sessionId?: string): Promise<ActivityItem[]> {
    await this.fetchData(sessionId);
    return this.activityItems || [];
  }

  async loadEvents(sessionId?: string): Promise<Event[]> {
    await this.fetchData(sessionId);
    return this.events || [];
  }
  
  async loadCompletedAnalyses(sessionId?: string): Promise<RunningAnalysis[]> {
    await this.fetchData(sessionId);
    return this.completedAnalyses || [];
  }

  async loadScreenshot(item: ActivityItem): Promise<string | null> {
    console.log('[RemoteDataProvider.loadScreenshot] Called with item:', {
      id: item.id,
      type: item.type,
      user_id: item.user_id,
      session_id: item.session_id,
      image_id: item.type === 'ui_diff' ? item.image2_id : item.image_id
    });
    
    const imageId = item.type === 'ui_diff' ? item.image2_id : item.image_id;
    if (!imageId) {
      console.error('[RemoteDataProvider] Activity item has no image ID.', item);
      return null;
    }

    // `initial_dump` items are local-only and won't have a remote screenshot.
    if (item.type === 'initial_dump') {
      console.warn('[RemoteDataProvider] Attempted to load screenshot for a local-only "initial_dump" activity. These do not have remote screenshots. Skipping.');
      return null;
    }

    // The API now provides user_id and session_id on the activity item
    const userId = item.user_id;
    const sessionId = item.session_id;

    if (!userId || !sessionId) {
      // This can happen if a locally-generated item (like a ui_diff) is still in state
      // when switching to remote view. These don't have remote screenshots.
      if (item.type === 'ui_diff') {
        console.warn(`[RemoteDataProvider] Skipping screenshot for local "ui_diff" activity: ${item.id}`);
        return null;
      }
      console.error('[RemoteDataProvider] Missing user_id or session_id on the activity item for URL construction.', item);
      return null;
    }
    
    const path = `${userId}/${sessionId}/screenshots/${imageId}.jpeg`;
    
    try {
      // Fetch a short-lived, secure URL from our backend
      const response = await fetch('/api/capture/get-download-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });

      if (!response.ok) {
        const errorBody = await response.json();
        console.warn(`[RemoteDataProvider] Failed to get download URL for ${path}:`, errorBody.details || response.statusText);
        return null;
      }
      
      const data = await response.json();
      // The 'signedUrl' property contains the temporary URL for the image
      return data.signedUrl;

    } catch (err) {
      console.error(`[RemoteDataProvider] Error fetching signed download URL for ${path}:`, err);
      return null;
    }
  }

  async loadWorkflowSteps(): Promise<Array<{ id: string; analysis: string; parsed: ParsedAnalysis | null; timestamp: string; }>> {
    // TODO: Implement remote workflow step loading if they are stored in Supabase
    console.warn('[RemoteDataProvider] loadWorkflowSteps is not implemented yet.');
    return [];
  }
} 