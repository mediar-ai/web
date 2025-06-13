import type { DataProvider, ActivityItem, Event, RunningAnalysis, ParsedAnalysis } from '@/types';
import { 
  loadActivityItems as loadLocalActivityItems,
  loadEvents as loadLocalEvents,
  getScreenshotById,
  loadWorkflowSteps as loadLocalWorkflowSteps,
  loadCompletedAnalyses as loadLocalCompletedAnalyses
} from './db';
import { supabase } from './supabase';

export const LocalDataProvider: DataProvider = {
  loadActivityItems: async () => loadLocalActivityItems(),
  loadEvents: async () => loadLocalEvents(),
  loadScreenshot: async (id: string) => getScreenshotById(id),
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
    // Only fetch if data hasn't been loaded yet
    if (this.activityItems !== null && this.events !== null && this.completedAnalyses !== null) {
      return;
    }

    try {
      const url = sessionId 
        ? `/api/users/${this.userId}/data?sessionId=${sessionId}`
        : `/api/users/${this.userId}/data`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote data for user ${this.userId}`);
      }
      const data = await response.json();
      
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

  async loadScreenshot(id: string): Promise<string | null> {
    // Screenshots are identified by their frame ID, which contains session info
    // Format: `session-screenshotNumber`
    const parts = id.split('-');
    if (parts.length < 2) {
      console.error('[RemoteDataProvider] Invalid screenshot ID format:', id);
      return null;
    }
    const sessionId = parts[0]; 
    const sequenceId = parts.slice(0, 2).join('-'); // e.g., "1-3"
    
    // Construct the path to the screenshot in Supabase Storage
    const path = `${this.userId}/${sessionId}/screenshots/${sequenceId}.jpeg`;
    
    const { data } = supabase.storage.from('recordings').getPublicUrl(path);

    if (!data || !data.publicUrl) {
      console.warn(`[RemoteDataProvider] Could not get public URL for screenshot: ${path}`);
      return null;
    }
    
    // Check if the image actually exists before returning the URL
    try {
      const response = await fetch(data.publicUrl, { method: 'HEAD' });
      if (response.ok) {
        return data.publicUrl;
      }
      console.warn(`[RemoteDataProvider] Screenshot not found at public URL (HEAD request failed): ${data.publicUrl}`);
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