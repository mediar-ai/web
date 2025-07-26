// =============================================================================
// Timeline Workflow Mapping Type Definitions
// Supporting enhanced workflow timeline mapping with granular details
// =============================================================================

// Database table types
export interface WorkflowType {
  id: number;
  workflow_template_id: number;
  type_name: string;                    // "Premium Path", "Express Order"
  type_description?: string;            // Human readable description
  conditions: Record<string, unknown>;      // Conditions that trigger this type
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowInstance {
  id: number;
  workflow_type_id: number;
  instance_name: string;                // "Customer: John Doe", "Order: #12345"
  instance_data: Record<string, unknown>;   // Structured data about this instance
  status: 'active' | 'completed' | 'failed' | 'paused';
  started_at?: string;
  completed_at?: string;
  user_id: string;
  session_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TimelineEventWorkflowMapping {
  id: number;
  
  // Core relationships
  timeline_event_id: number;
  workflow_template_id: number;
  workflow_type_id: number;
  workflow_instance_id: number;
  
  // Step hierarchy
  workflow_step: string;               // Step name within workflow
  workflow_substep?: string;           // Optional substep breakdown
  step_sequence?: number;              // Order within workflow
  
  // Event context (flexible arrays)
  event_inputs: string[];              // What led to this event
  event_outputs: string[];             // What this event produced
  business_logics: string[];           // Rules governing this event
  
  // Metadata
  confidence_score?: number;           // 0-1 confidence score
  analysis_timestamp: string;
  model_used: string;
  
  // Tracking
  user_id: string;
  session_id?: string;
  created_at: string;
}

export interface TimelineEventUnrelated {
  id: number;
  timeline_event_id: number;
  unrelated_reason: string;            // Why this event is unrelated
  confidence_score?: number;           // 0-1 confidence score
  analysis_timestamp: string;
  model_used: string;
  user_id: string;
  session_id?: string;
  created_at: string;
}

// =============================================================================
// Raw timeline event annotations (current system)
// =============================================================================

export interface RawTimelineEventAnnotation {
  id: number;
  raw_event_id: number;
  analysis_id: number;
  is_workflow_related: boolean;
  user_action?: string | null;
  ui_element_interacted?: string | null;
  content_change?: string | null;
  timestamp_context?: string | null;
  unrelated_reason?: string | null;
  confidence_score?: number | null;
  model_used?: string | null;
  user_id: string;
  session_id?: string | null;
  // Workflow ID columns
  workflow_template_id?: number | null;
  workflow_type_id?: number | null;
  workflow_instance_id?: number | null;
  workflow_step_id?: number | null;
  workflow_substep_id?: number | null;
  // Workflow context
  inputs?: string | null;
  outputs?: string | null;
  business_logics?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEventWorkflowMappingWithDetails extends TimelineEventWorkflowMapping {
  // Joined data from related tables
  workflow_template: {
    id: number;
    title: string;
    steps: string[];
  };
  workflow_type: {
    id: number;
    type_name: string;
    type_description?: string;
  };
  workflow_instance: {
    id: number;
    instance_name: string;
    status: string;
  };
}

// =============================================================================
// LLM Analysis Request/Response Types
// =============================================================================

export interface TimelineEventAnalysisRequest {
  user_id: string;
  session_id?: string;
  events: Array<{
    id: number;
    timestamp: string;
    event_type: string;
    payload: Record<string, unknown>;
  }>;
  existing_workflows: Array<{
    id: number;
    title: string;
    steps: string[];
    inputs: string[];
    outputs: string[];
    business_logic: string[];
  }>;
  model?: string;
}

export interface WorkflowMappingAnalysisResult {
  timeline_event_id: number;
  workflow_template_id: number;
  workflow_template_title: string;
  workflow_type_name: string;
  workflow_type_description?: string;
  workflow_instance_name: string;
  workflow_instance_data?: Record<string, unknown>;
  workflow_step: string;
  workflow_substep?: string;
  step_sequence?: number;
  event_inputs: string[];
  event_outputs: string[];
  business_logics: string[];
  confidence_score: number;
}

export interface UnrelatedEventAnalysisResult {
  timeline_event_id: number;
  unrelated_reason: string;
  confidence_score: number;
}

export interface TimelineEventAnalysisResponse {
  analysis_timestamp: string;
  model_used: string;
  workflow_mappings: WorkflowMappingAnalysisResult[];
  unrelated_events: UnrelatedEventAnalysisResult[];
  total_events_analyzed: number;
  total_workflow_mappings: number;
  total_unrelated_events: number;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

export interface FetchTimelineEventMappingsRequest {
  user_id: string;
  session_id?: string;
  timeline_event_ids?: number[];       // Optional filter by specific events
  workflow_template_ids?: number[];    // Optional filter by specific workflows
  start_date?: string;                 // Optional date range filter
  end_date?: string;
  include_unrelated?: boolean;         // Whether to include unrelated events
}

export interface FetchTimelineEventMappingsResponse {
  annotations: RawTimelineEventAnnotation[];
  total_events: number;
  workflow_related_count: number;
  unrelated_count: number;
}

export interface SaveTimelineEventMappingsRequest {
  user_id: string;
  session_id?: string;
  analysis_result: TimelineEventAnalysisResponse;
  workflow_id_map: { [key: string]: number };
}

export interface SaveTimelineEventMappingsResponse {
  success: boolean;
  annotations_created: number;
  errors?: string[];
}

// =============================================================================
// Utility Types
// =============================================================================

export type WorkflowMappingStatus = 'mapped' | 'unrelated' | 'unmapped';

export interface WorkflowMappingSummary {
  total_events: number;
  mapped_events: number;
  unrelated_events: number;
  unmapped_events: number;
  unique_workflows: number;
  unique_workflow_types: number;
  unique_workflow_instances: number;
  average_confidence: number;
}
