export interface TimelineAnnotation {
  id?: number; // Primary key from database
  user_id?: string;
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  is_workflow_related: boolean;
  model_used?: string;
  unrelated_reason?: string | null;
  workflow_id?: number | null;
  workflow_type_id?: number | null;
  workflow_instance_id?: number | null;
  workflow_step_id?: number | null;
  workflow_substep_id?: number | null;
  template_name?: string;
  type_name?: string;
  instance_name?: string;
  step_name?: string;
  substep_name?: string;
  event_type?: string;
  step_title?: string;
  user_intent?: string;
  step_summary?: string;
  events_that_happened?: string;
  how_content_changed?: string;
  results_if_any?: string;
  what_was_clicked?: string;
  what_was_typed?: string;
  window_title?: string;
  inputs?: string | string[] | null;
  outputs?: string | string[] | null;
  business_logics?: string | null;
  created_at: string;
  event_payload?: Record<string, unknown>;
  event_created_at?: string;
  // Labeling data
  selected_labels?: string[];
  suggested_labels?: string[];
} 