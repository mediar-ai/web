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
  
  constructor(userId: string) {
    this.userId = userId;
  }
  
  private async fetchDataForSession(sessionId?: string) {
    try {
      const url = sessionId 
        ? `/api/users/${this.userId}/data?sessionId=${sessionId}`
        : `/api/users/${this.userId}/data`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch remote data for user ${this.userId}`);
      }
      return await response.json();
    } catch (error) {
      console.error('[RemoteDataProvider] Error fetching data:', error);
      // Return a default structure on error to prevent crashes
      return { userName: null, activityItems: [], events: [], completedAnalyses: [] };
    }
  }

  getUserName(): string | null {
    return this.userName;
  }

  async loadActivityItems(sessionId?: string): Promise<ActivityItem[]> {
    const data = await this.fetchDataForSession(sessionId);
    if (data.userName) this.userName = data.userName;
    return data.activityItems || [];
  }

  async loadEvents(sessionId?: string): Promise<Event[]> {
    const data = await this.fetchDataForSession(sessionId);
    if (data.userName) this.userName = data.userName;
    return data.events || [];
  }
  
  async loadCompletedAnalyses(sessionId?: string): Promise<RunningAnalysis[]> {
    const data = await this.fetchDataForSession(sessionId);
    if (data.userName) this.userName = data.userName;
    return data.completedAnalyses || [];
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