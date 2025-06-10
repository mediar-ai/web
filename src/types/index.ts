export interface BufferedFrame {
  id: string;
  imageDataUrl: string;
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

export interface InitialFrameDumpAnalysis {
  type: 'initial_dump';
  id: string; // Frame ID, can be the same as image_id for simplicity here
  timestamp: string;
  raw_content: string;
  image_id: string; // ID of the dumped frame from BufferedFrame
  processedForEvent?: boolean;
  sequenceId?: string; // Format: "sessionId-screenshotNumber" e.g. "1-3"
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
}

export type ActivityItem = InitialFrameDumpAnalysis | UIDiffAnalysis;

export interface ScreenshotForExport {
  id: string;
  dataUrl: string;
  timestamp: number;
  size: number;
}

// Helper types for props of new internal components
export type PageHeaderControlsProps = {
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
  exportInProgress: boolean;
};

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
  handleExportAllData: () => void;
  exportInProgress: boolean;
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
    type: string;
    timestamp: string;
    event: Record<string, unknown>; // More specific than any
  };
  created_at: string;
} 