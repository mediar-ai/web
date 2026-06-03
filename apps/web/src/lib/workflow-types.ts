// Types for workflow system
export type InputParameter = {
  type: string;
  description: string;
  required: boolean;
  default?: any;
  // For conditional parameters
  controls?: Record<string, Record<string, InputParameter>>;
  // Additional properties for UI rendering
  label?: string;
  regex?: string;
  validation_message?: string;
  options?: Array<{ value: string; label: string }> | string[];
};

// These types are no longer used and will be removed.
/*
export type ValidationCheck = {
  check_id: string;
  description: string;
  expression: string; // e.g., "output.quote_value > 0"
};

export type ErrorHandlingRule = {
  rule_id: string;
  error_condition: string; // e.g., "step_failed" or "output_missing"
  action: 'retry' | 'skip' | 'terminate';
  action_params?: Record<string, unknown>;
};
*/

export interface Workflow {
  id: number;
  uuid?: string; // Stable workflow UUID (deployed_workflows.uuid); matches the desktop app's copyable ID
  name: string;
  description: string;
  version: string;
  status: 'draft' | 'pending' | 'deployed' | 'paused' | 'failed' | 'inactive';
  workflow_type: 'execution' | 'settings';
  parent_workflow_id?: number | null;
  display_order: number;
  automation_sequence: any; // Keeping as 'any' for now
  preferred_format?: string; // 'typescript' | 'yaml' | 'jsonb' - used for executor routing
  typescript_metadata?: any; // Compiled TS workflow (name/steps/inputs/...) for TS workflows
  input_parameters: Record<string, InputParameter>;
  expected_outputs: Record<string, unknown>;
  sample_inputs: Record<string, unknown>;
  estimated_duration_seconds?: number;
  category: string;
  successful_runs: number;
  failed_runs: number;
  cancelled_runs: number;
  skipped_runs?: number; // Optional for backward compatibility
  total_executions: number;
  // Cron scheduling fields
  cron_expression?: string | null;
  cron_timezone?: string;
  cron_enabled?: boolean;
  last_scheduled_execution?: string | null;
  next_scheduled_execution?: string | null;
  cron_max_concurrent?: number;
  cron_retry_on_failure?: boolean;
  cron_retry_count?: number;
  // Cron failure tracking fields
  consecutive_failures?: number;
  last_failure_message?: string | null;
  cron_auto_paused?: boolean;
  auto_paused_at?: string | null;
  auto_pause_reason?: string | null;
  success_rate: number | null;
  // Version-specific statistics
  current_version_stats?: {
    successful_runs: number;
    failed_runs: number;
    total_executions: number;
    success_rate: number;
    average_duration_seconds?: number;
  };
  overall_stats?: {
    successful_runs: number;
    failed_runs: number;
    total_executions: number;
    success_rate: number;
  };
  version_info?: {
    current_version: string;
    total_versions: number;
  };
  created_at: string;
  updated_at: string;
  last_activity_at?: string; // When workflow was last active (execution completed, stats updated)
  last_modified_at?: string; // When workflow definition was last modified (from active version)
  // Organization fields (populated for Mediar admins)
  organization_id?: string;
  is_public?: boolean; // Whether workflow is publicly accessible to all organizations
  shared_with_orgs?: string[];
  tags?: string[]; // Array of tags for filtering (e.g., dev, prod, wip, test)
}

// Workflow with nested settings workflows
export interface WorkflowWithSettings extends Workflow {
  settings_workflows: Workflow[];
}

export type WorkflowOverview = Omit<Workflow, 'automation_sequence'>;

export interface WorkflowResult {
  success: boolean;
  state: 'success' | 'failure' | 'skipped';
  execution_status: string;
  message: string;
  data?: any;
  error?: string | null;
  duration_ms: number;
  steps_executed: number;
  skipped?: boolean;
  validation?: Record<string, unknown>;
}

export interface ExecutionResult {
  // Standardized workflow result from output parser
  workflow_result?: WorkflowResult;
  // Optional structured outputs (user-defined schema)
  mediar_parser?: Array<Record<string, unknown>>;
  quotes?: Array<{
    provider: string;
    premium: number;
    coverage: string;
    [key: string]: unknown;
  }>;
  error_details?: string;
  execution_summary?: {
    workflow_completed: boolean;
  };
  performance_metrics?: {
    successful_steps: number;
    failed_steps: number;
    total_steps: number;
  };
  error_stage?: string;
}

export interface Execution {
  execution_id: number;
  workflow_id: number;
  workflow_name: string;
  workflow_organization_id?: string | null;
  workflow_organization_name?: string | null;
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'error'
    | 'timeout'
    | 'skipped';
  execution_status?: string; // Granular status like 'completed_with_errors'
  created_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_seconds?: number;
  modal_call_id: string;
  error_message?: string;
  error_analysis?: string; // AI-generated error analysis
  error_analyzed_at?: string; // When the error was analyzed
  client_id?: string;
  execution_params?: Record<string, unknown>;
  // Machine assignment info
  assigned_machine_id?: number;
  assigned_machine_name?: string;
  executor_type?: 'python' | 'rust' | null;
  // Version information
  version_number?: string;
  workflow_version_id?: number;
  results?: ExecutionResult;
  formatted_output?: string;
  raw_logs?: string;
  raw_mcp_response?: Record<string, unknown>;
  execution_logs?: Array<{
    timestamp: string;
    level: string;
    message: string;
  }>;
  progress_percentage?: number;
  current_step_index?: number;
  total_steps?: number;
  current_step_description?: string;
  raw_data?: {
    raw_logs: string | null;
    raw_mcp_response: Record<string, unknown> | null;
    execution_logs: Array<{
      timestamp: string;
      level: string;
      message: string;
    }>;
    has_raw_logs: boolean;
    has_mcp_response: boolean;
    has_execution_logs: boolean;
  };
  screenshots?: string[] | null; // Array of S3 URLs or base64 PNG strings
}

export interface LiveExecutionStatus {
  id: number;
  workflow_id: number;
  workflow_name: string;
  workflow_description: string;
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'skipped';
  progress_percentage: number;
  current_step_index: number;
  total_steps: number;
  current_step_description: string | null;
  step_start_time: string | null;
  estimated_completion_time: string | null;
  started_at: string | null;
  created_at: string;
  execution_duration_seconds: number | null;
  modal_call_id: string;
  // Version information
  version_number?: string;
  workflow_version_id?: number;
  client_id: string;
  estimated_seconds_remaining: number | null;
  steps_per_minute: number | null;
  runtime_seconds?: number;
}
