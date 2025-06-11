import type { DataProvider, ActivityItem, Event, RunningAnalysis, ParsedAnalysis } from '@/types';
import { 
  loadActivityItems as loadLocalActivityItems,
  loadEvents as loadLocalEvents,
  getScreenshotById,
  loadWorkflowSteps as loadLocalWorkflowSteps,
  loadCompletedAnalyses as loadLocalCompletedAnalyses
} from './db';

export class LocalDataProvider implements DataProvider {
  async loadActivityItems(): Promise<ActivityItem[]> {
    console.log('[LocalDataProvider] Loading activity items from IndexedDB');
    return loadLocalActivityItems();
  }

  async loadEvents(): Promise<Event[]> {
    console.log('[LocalDataProvider] Loading events from IndexedDB');
    return loadLocalEvents();
  }

  async loadScreenshot(id: string): Promise<Blob | null> {
    console.log('[LocalDataProvider] Loading screenshot from IndexedDB:', id);
    return getScreenshotById(id);
  }

  async loadWorkflowSteps(): Promise<Array<{
    id: string;
    analysis: string;
    parsed: ParsedAnalysis | null;
    timestamp: string;
  }>> {
    console.log('[LocalDataProvider] Loading workflow steps from IndexedDB');
    return loadLocalWorkflowSteps();
  }

  async loadCompletedAnalyses(): Promise<RunningAnalysis[]> {
    console.log('[LocalDataProvider] Loading completed analyses from IndexedDB');
    return loadLocalCompletedAnalyses();
  }
}

export class RemoteDataProvider implements DataProvider {
  private userId: string;
  private sessionId: string;

  constructor(userId: string, sessionId: string) {
    this.userId = userId;
    this.sessionId = sessionId;
  }

  async loadActivityItems(): Promise<ActivityItem[]> {
    console.log('[RemoteDataProvider] Loading activity items for session:', this.sessionId);
    
    const response = await fetch(`/api/users/${this.userId}/sessions/${this.sessionId}/activities`);
    if (!response.ok) {
      console.error('[RemoteDataProvider] Failed to load activities:', response.statusText);
      return [];
    }
    
    const data = await response.json();
    return data;
  }

  async loadEvents(): Promise<Event[]> {
    console.log('[RemoteDataProvider] Loading events for session:', this.sessionId);
    
    const response = await fetch(`/api/users/${this.userId}/sessions/${this.sessionId}/events`);
    if (!response.ok) {
      console.error('[RemoteDataProvider] Failed to load events:', response.statusText);
      return [];
    }
    
    const data = await response.json();
    return data;
  }

  async loadScreenshot(id: string): Promise<string | null> {
    console.log('[RemoteDataProvider] Loading screenshot URL for:', id);
    
    // For remote viewing, we'll need to fetch the screenshot URL from Supabase storage
    // This will be implemented when we have the screenshot storage structure
    // For now, return null
    
    const response = await fetch(`/api/users/${this.userId}/sessions/${this.sessionId}/screenshots/${id}`);
    if (!response.ok) {
      console.error('[RemoteDataProvider] Failed to load screenshot:', response.statusText);
      return null;
    }
    
    const data = await response.json();
    return data.url || null;
  }

  async loadWorkflowSteps(): Promise<Array<{
    id: string;
    analysis: string;
    parsed: ParsedAnalysis | null;
    timestamp: string;
  }>> {
    console.log('[RemoteDataProvider] Loading workflow steps for session:', this.sessionId);
    
    // Workflow steps might not be available for remote sessions
    // Return empty array for now
    return [];
  }

  async loadCompletedAnalyses(): Promise<RunningAnalysis[]> {
    console.log('[RemoteDataProvider] Loading completed analyses for session:', this.sessionId);
    
    // Analyses might not be available for remote sessions
    // Return empty array for now
    return [];
  }
} 