export interface BufferedFrame {
  id: string;
  imageDataUrl: string;
  base64Data?: string; // Pure base64 data for processing
  timestamp: number;
  percentChange: number;
  sequenceId?: string; // Format: "sessionId-screenshotNumber" e.g. "1-3"
}

// Updated Event interface
export interface Event {
  id: string;
  summary: string; // The concise summary
  thoughts?: string; // Optional thought process from the model
  timestamp: string;
  activity_ids?: string[]; // The IDs of the activities that generated this event
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  sessionId: string;
}

export interface ParsedAnalysis {
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
}

// New flexible schema types for JSONB storage
export interface LLMStructuredOutput {
  // Legacy v1 schema (original 8 fields)
  workflow?: string;
  step?: string;
  description?: string;
  facts?: string;
  logic?: string;
  tech?: string;
  apps?: string;
  context?: string;
  
  // New v2 schema (proposed 8 fields)
  step_title?: string;
  step_summary?: string;
  events_that_happened?: string;
  how_content_changed?: string;
  results_if_any?: string;
  what_was_clicked?: string;
  what_was_typed?: string;
  user_intent?: string;
  
  // Future extensibility
  [key: string]: unknown;
  
  // Schema metadata
  schema_version?: string;
  model_used?: string;
  generation_timestamp?: string;
}

// Enhanced WorkflowStepAnalysis that supports both legacy columns and JSONB
export interface WorkflowStepAnalysisWithJSONB {
  id: string;
  user_id: string;
  session_id: string;
  client_timestamp: string;
  created_at: string;
  source_ui_tree_event_id?: number | null;
  
  // Legacy columns (for backward compatibility)
  workflow?: string;
  step?: string;
  description?: string;
  facts?: string;
  logic?: string;
  tech?: string;
  apps?: string;
  context?: string;
  
  // New JSONB column
  llm_structured_output?: LLMStructuredOutput;
}

// Helper type for accessing flattened fields regardless of storage method
export interface FlattenedWorkflowAnalysis {
  id: string;
  user_id: string;
  session_id: string;
  client_timestamp: string;
  created_at: string;
  source_ui_tree_event_id?: number | null;
  
  // Flattened access (prioritizes JSONB over legacy columns)
  workflow: string;
  step: string;
  description: string;
  facts: string;
  logic: string;
  tech: string;
  apps: string;
  context: string;
  
  // Additional metadata
  schema_version?: string;
  raw_llm_output?: LLMStructuredOutput;
  llm_generated_label?: string | null;
}

export interface InitialFrameDumpAnalysis {
  type: 'initial_dump';
  id: string; // Frame ID, can be the same as image_id for simplicity here
  timestamp: string;
  raw_content: string;
  image_id: string; // ID of the dumped frame from BufferedFrame
  processedForEvent?: boolean;
  sequenceId?: string; // Format: "sessionId-screenshotNumber" e.g. "1-3"
  user_id?: string; // Added for remote data fetching
  session_id?: string; // Added for remote data fetching
}

// UIDiffAnalysis now includes a type discriminator
export interface UIDiffAnalysis {
  type: 'ui_diff';
  id: string;
  timestamp: string;
  change_detected: 'yes' | 'no';
  change_description?: string;
  identified_change_types?: string[];
  mouse_movement_details?: {
    from_object?: string;
    from_coordinate?: string;
    to_object?: string;
    to_coordinate?: string;
  };
  typing_details?: string;
  click_details?: string;
  new_window_details?: {
    old_window_name?: string;
    new_window_name?: string;
  };
  new_app_details?: string;
  scroll_details?: {
    new_content_summary?: string;
  };
  other_change_details?: Array<{
    type_description?: string;
    details?: string;
  }>;
  unidentified_changes_explanation?: string;
  new_content_detected?: string; // Added new field
  image1_id?: string;
  image2_id?: string;
  processedForEvent?: boolean;
  sequenceId?: string; // Format: "sessionId-screenshotNumber" e.g. "1-3" - from the second/newer frame
  user_id?: string; // Added for remote data fetching
  session_id?: string; // Added for remote data fetching
}

export type ActivityItem = InitialFrameDumpAnalysis | UIDiffAnalysis;

export interface ScreenshotForExport {
  id: string;
  dataUrl: string;
  timestamp: number;
  size: number;
}

// Helper types for props of new internal components
export interface PageHeaderControlsProps {
  stream: MediaStream | null;
  handleStartScreenShare: () => void;
  handleStopScreenShare: () => void;
  onTogglePip: () => void;
  isPipOpen: boolean;
  mainStatus: string;
  autoDetectionEnabled: boolean;
  isMonitoring: boolean;
  displayChangePercent: number;
  activeAnalysesCount: number;
  error: string | null;
  streamRef: React.RefObject<MediaStream | null>;
  MAX_PARALLEL_ANALYSES: number;
  reconnectRequired: boolean;
}

export type VideoPreviewAreaProps = {
  stream: MediaStream | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onCollapseChange?: (isCollapsed: boolean) => void;
};

export type ErrorNotificationProps = {
  error: string | null;
  showError: boolean;
  dismissError: () => void;
};

export type ExportStatusDialogProps = {
  exportInProgress: boolean;
};

export type EventsTabContentProps = {
  events: Event[];
  selectedEvent: Event | null;
  onEventSelect: (event: Event) => void;
};

export type ActivityTabContentProps = {
  activityItems: ActivityItem[];
  selectedActivity: ActivityItem | null;
  onActivitySelect: (item: ActivityItem) => void;
};

export type SettingsTabContentProps = {
  customPrompt: string;
  handlePromptChange: (newPrompt: string) => void;
  promptSaveStatus: 'idle' | 'saving' | 'saved';
  eventsPrompt: string;
  EVENTS_MODEL_NAME: string;
  autoDetectionEnabled: boolean;
  setAutoDetectionEnabled: (enabled: boolean) => void;
  monitoringFrequency: number;
  setMonitoringFrequency: (freq: number) => void;
  changeThreshold: number;
  setChangeThreshold: (thresh: number) => void;
  stabilityDelay: number;
  setStabilityDelay: (delay: number) => void;
  screenshotQuality: number;
  setScreenshotQuality: (quality: number) => void;
  maxScreenshots: number;
  setMaxScreenshots: (max: number) => void;
  pixelDifferenceThreshold: number;
  setPixelDifferenceThreshold: (thresh: number) => void;
  stream: MediaStream | null;
  activeAnalysesCount: number;
};

export type DebugTabContentProps = {
  frontendLogs: string[];
  copyLogsToClipboard: () => void;
  copyStatus: 'idle' | 'copied';
  clearAllData: () => void;
};

// Adding missing prop types that were defined earlier in page.tsx
export interface MemoizedScrollAreaContentProps {
  content: React.ReactNode;
  className?: string;
  viewportRef?: React.RefObject<HTMLDivElement>;
}

export interface MemoizedDebugLogsScrollAreaProps {
  logs: string[];
}

// =================================================================
// Types for the new Timeline View
// =================================================================

export type TimelineItem =
  | (Event & { itemType: 'event' })
  | (ActivityItem & { itemType: 'activity' });

export interface TimelineListProps {
  timelineItems: TimelineItem[];
  selectedItem: TimelineItem | null;
  onSelectItem: (item: TimelineItem) => void;
}

export interface ScreenshotPreviewProps {
  selectedItem: TimelineItem | null;
  timelineItems: TimelineItem[];
}

export interface DetailsPaneProps {
  selectedItem: TimelineItem | null;
}

export interface TimelineViewProps {
  timelineItems: TimelineItem[];
}

export interface RunningAnalysis {
  id: string;
  type: string;
  startTime?: number;
  endTime?: number;
  model?: string;
  status: 'queued' | 'running' | 'failed' | 'completed';
  payloadType: 'image' | 'text';
  payloadSize?: number;
  sequenceId?: string; // Format: "sessionId-screenshotNumber" e.g. "1-3"
}

export interface LiveAnalysesPanelProps {
  runningAnalyses: RunningAnalysis[];
}

export interface LowLevelEvent {
  id: number;
  session_id: string;
  user_id?: string;
  payload: {
    payload?: {
      type: string;
      timestamp: string;
      event: {
        screenshot_diff?: {
          before?: string;
          after?: string;
          before_timestamp?: string;
          after_timestamp?: string;
        };
        [key: string]: unknown;
      };
    }
  };
  created_at: string;
}

// =================================================================
// Types for Multi-User Viewing
// =================================================================

export type ViewingMode =
  | { type: 'local'; userName?: never; }
  | { type: 'remote'; userId: string; sessionId?: string; userName?: string };

export interface PaginationInfo {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface PaginatedActivityResult {
  activityItems: ActivityItem[];
  pagination: PaginationInfo;
}

export interface DataProvider {
  loadActivityItems(sessionId?: string): Promise<ActivityItem[]>;
  loadActivityItemsWithPagination(sessionId?: string): Promise<PaginatedActivityResult>;
  loadMoreActivityItems(offset: number, sessionId?: string): Promise<PaginatedActivityResult>;
  loadEvents(sessionId?: string): Promise<Event[]>;
  loadScreenshot(item: ActivityItem): Promise<Blob | string | null>;
  loadWorkflowSteps(sessionId?: string): Promise<Array<{
    id: string;
    analysis: string;
    parsed: ParsedAnalysis | null;
    timestamp: string;
  }>>;
  loadCompletedAnalyses(sessionId?: string): Promise<RunningAnalysis[]>;
  getUserName?(): string | null;
}

export interface Session {
  id: string;
  eventCount: number;
  processed_event_count?: number;
  total_ui_steps?: number;
  total_workflow_analyses?: number;
  distinct_workflows_created?: number;
  llm_generated_labeled_steps?: number;
  duration_seconds?: number;
  status: 'live' | 'ended';
  timestamp: string;
  type: string;
}

export interface UserSessionData {
  name: string | null;
  sessions: Session[];
}