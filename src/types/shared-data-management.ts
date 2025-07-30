// Shared types for data management across Raw Events and Steps tabs
import type { LowLevelEvent } from './index';

// Workflow analysis interface (flattened from existing types)
export interface WorkflowStepAnalysis {
  id: string;
  user_id: string;
  session_id: string;
  client_timestamp: string;
  created_at: string;
  llm_structured_output: Record<string, unknown>;
  window_title?: string;
  source_ui_tree_event_id?: number | null;
}

// Dataset entry interface for annotations
export interface DatasetEntry {
  id: string;
  user_id: string;
  low_level_workflow_analysis_id: string;
  generated_output: string;
  feedback: 'good' | 'bad' | 'irrelevant' | null;
  feedback_reason: string | null;
  created_at: string;
  updated_at: string;
  dataset_type?: string;
}

// Event feedback data for labeling workflow
export interface EventFeedbackData {
  generated_output: string;
  feedback: 'good' | 'bad' | 'irrelevant' | null;
  feedback_reason: string | null;
}

// Unified storage info interface
export interface LabelingStorageInfo {
  totalSize: number;
  maxSize: number;
  usagePercentage: number;
  
  eventCount: number;
  eventsSize: number;
  eventsUsagePercentage: number;
  
  analysisCount: number;
  analysesSize: number;
  analysesUsagePercentage: number;
  
  annotationCount: number;
  annotationsSize: number;
  annotationsUsagePercentage: number;
  
  lastUpdated: Date;
}

// Unified data container
export interface UnifiedLabelingData {
  events: LowLevelEvent[];
  analyses: WorkflowStepAnalysis[];
  annotations: DatasetEntry[];
}

// Processing mode options
export type ProcessingMode = 'unprocessed' | 'all' | 'range';

// Load more progress tracking
export interface LoadProgress {
  loaded: number;
  total: number;
  currentBatch?: number;
  totalBatches?: number;
}

export interface StorageInfo {
  totalSize: number;
  eventCount: number;
  maxSize: number;
  usagePercentage: number;
}

export interface LoadAllProgress {
  loaded: number;
  total: number;
}

export interface TimeBoundary {
  startDate: Date | null;
  endDate: Date | null;
}

export interface DataControlsPanelProps {
  // Storage info
  storageInfo: StorageInfo | null;
  onClearStorage: () => void;
  
  // Memory management  
  memoryUsage: number;
  maxMemory: number;
  displayCount: number;
  totalAvailable: number | null;
  
  // Loading controls
  onLoadMore: () => void;
  isLoading: boolean;
  autoLoadingComplete: boolean;
  loadAllProgress: LoadAllProgress | null;
  
  // Filtering
  searchTerm: string;
  onSearchChange: (term: string) => void;
  selectedEventType: string | null;
  onEventTypeChange: (type: string) => void;
  availableEventTypes: string[];
  
  // Sort and export
  sortOrder: 'asc' | 'desc';
  onSortOrderChange: () => void;
  onExportData: () => void;
  
  // Time boundaries
  timeBoundary: TimeBoundary;
  onTimeBoundaryChange: (boundary: TimeBoundary) => void;
  
  // Optional Steps-specific props
  isLoadingPeriod?: boolean;
  onLoadEventsForPeriod?: () => void;
}

export interface LoadMoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadMore: (amount: string) => void;
  totalAvailable: number | null;
  currentLoaded: number;
  loadAllProgress: LoadAllProgress | null;
}

export interface DataManagementState {
  displayEvents: LowLevelEvent[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  searchTerm: string;
  selectedEventType: string | null;
  availableEventTypes: string[];
  sortOrder: 'asc' | 'desc';
  expandedEvents: Record<number, boolean>;
  copiedEventId: number | null;
  newEventIds: Set<number>;
  storageInfo: StorageInfo | null;
  currentDisplayLimit: number;
  totalAvailable: number | null;
  autoLoadingComplete: boolean;
  memoryUsage: number;
  loadAllProgress: LoadAllProgress | null;
  timeBoundary: TimeBoundary;
  isLoadingPeriod: boolean;
}

// Helper function types
export type FormatBytesFunction = (bytes: number) => string;
export type EstimateMemoryUsageFunction = (events: LowLevelEvent[]) => number; 