import type { DataProvider, ActivityItem, Event, RunningAnalysis, ParsedAnalysis } from '@/types';
import { 
  loadActivityItems as loadLocalActivityItems,
  loadEvents as loadLocalEvents,
  getScreenshotById,
  loadWorkflowSteps as loadLocalWorkflowSteps,
  loadCompletedAnalyses as loadLocalCompletedAnalyses
} from './db';
import { supabase } from './supabase';

const constructScreenshotUrl = (userId: string, sessionId: string, imageId: string): string => {
  const path = `${userId}/${sessionId}/screenshots/${imageId}.jpeg`;
  const { data } = supabase.storage.from('low-level-event-screenshots').getPublicUrl(path);
  return data.publicUrl;
};

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

    // The API now provides user_id and session_id on the activity item
    const userId = item.user_id;
    const sessionId = item.session_id;

    if (!userId || !sessionId) {
      console.error('[RemoteDataProvider] Missing user_id or session_id on the activity item for URL construction.', item);
      return null;
    }
    
    // Construct the correct path to the screenshot in Supabase Storage
    const url = constructScreenshotUrl(userId, sessionId, imageId);
    console.log('[RemoteDataProvider] Constructed URL:', url);
    
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        return url; // Return the public URL if the image exists
      }
      console.warn(`[RemoteDataProvider] Screenshot not found at public URL (HEAD request failed): ${url}`);
      return null;
    } catch(err) {
      console.error(`[RemoteDataProvider] Error checking screenshot existence:`, err);
      return null;
    }
  }

  async loadWorkflowSteps(): Promise<Array<{ id: string; analysis: string; parsed: ParsedAnalysis | null; timestamp: string; }>> {
    // TODO: Implement remote workflow step loading if they are stored in Supabase
    console.warn('[RemoteDataProvider] loadWorkflowSteps is not implemented yet.');
    return [];
  }
} 