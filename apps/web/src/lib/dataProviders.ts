import type { DataProvider, ActivityItem, Event, RunningAnalysis, ParsedAnalysis, PaginationInfo, PaginatedActivityResult } from '@/types';

export type { PaginationInfo, PaginatedActivityResult };

export class RemoteDataProvider implements DataProvider {
  private userId: string;
  private userName: string | null = null;
  private activityItems: ActivityItem[] | null = null;
  private events: Event[] | null = null;
  private completedAnalyses: RunningAnalysis[] | null = null;
  private pagination: PaginationInfo | null = null;
  private currentSessionId: string | undefined = undefined;

  constructor(userId: string) {
    this.userId = userId;
  }

  private async fetchData(sessionId?: string, offset: number = 0) {
    try {
      const cacheBuster = `cb=${Date.now()}`;
      let url = `/api/users/${this.userId}/data?${cacheBuster}&offset=${offset}`;
      if (sessionId) {
        url += `&sessionId=${sessionId}`;
      }

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
      this.pagination = data.pagination || null;
      this.currentSessionId = sessionId;

    } catch (error) {
      console.error('[RemoteDataProvider] Error fetching data:', error);
      this.activityItems = [];
      this.events = [];
      this.completedAnalyses = [];
      this.pagination = null;
    }
  }

  getUserName(): string | null {
    return this.userName;
  }

  getPagination(): PaginationInfo | null {
    return this.pagination;
  }

  async loadActivityItems(sessionId?: string): Promise<ActivityItem[]> {
    await this.fetchData(sessionId, 0);
    return this.activityItems || [];
  }

  async loadActivityItemsWithPagination(sessionId?: string): Promise<PaginatedActivityResult> {
    await this.fetchData(sessionId, 0);
    return {
      activityItems: this.activityItems || [],
      pagination: this.pagination || { offset: 0, limit: 1000, total: 0, hasMore: false },
    };
  }

  async loadMoreActivityItems(offset: number, sessionId?: string): Promise<PaginatedActivityResult> {
    try {
      const cacheBuster = `cb=${Date.now()}`;
      let url = `/api/users/${this.userId}/data?${cacheBuster}&offset=${offset}`;
      if (sessionId) {
        url += `&sessionId=${sessionId}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch more activity items for user ${this.userId}`);
      }
      const data = await response.json();
      console.log('[RemoteDataProvider] More activity items received:', data.activityItems?.length);

      return {
        activityItems: data.activityItems || [],
        pagination: data.pagination || { offset, limit: 1000, total: 0, hasMore: false },
      };

    } catch (error) {
      console.error('[RemoteDataProvider] Error loading more activity items:', error);
      return {
        activityItems: [],
        pagination: { offset, limit: 1000, total: 0, hasMore: false },
      };
    }
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