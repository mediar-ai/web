// Types for workflow system
export interface AutomationStep {
  action?: string;
  description?: string;
  url?: string;
  selector?: string;
  step_number?: number;
  estimated_duration?: number;
  [key: string]: unknown;
}

export interface InputParameter {
  type?: string;
  required?: boolean;
  default?: unknown;
  description?: string;
  example?: unknown;
  values?: unknown[];
  [key: string]: unknown;
}

export interface ValidationCheck {
  name: string;
  description: string;
  type: string;
  condition?: string;
}

export interface ErrorHandlingRule {
  error_condition: string;
  recovery_actions: Array<{
    action: string;
    description: string;
  }>;
}

export interface WorkflowOverview {
  id: number;
  name: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  difficulty_level: string;
  estimated_duration_seconds: number;
  total_steps: number;
  automation_sequence: AutomationStep[];
  input_parameters: Record<string, InputParameter>;
  expected_outputs: Record<string, unknown>;
  sample_inputs: Record<string, unknown>;
  performance_metrics?: {
    successful_runs: number;
    failed_runs: number;
    total_executions: number;
    success_rate: number;
  };
  validation_checks: ValidationCheck[];
  error_handling: ErrorHandlingRule[];
  deployment_status: string;
  modal_function_name: string;
  last_updated?: string;
}

export interface Workflow {
  id: number;
  name: string;
  description: string;
  version?: string;
  status?: string;
  category: string;
  tags: string[];
  difficulty_level: string;
  estimated_duration_seconds: number;
  success_rate: number | null;
  deployment_status: string;
  input_parameters: Record<string, InputParameter>;
  expected_outputs: Record<string, unknown>;
  successful_runs?: number;
  failed_runs?: number;
  total_executions?: number;
  automation_sequence?: AutomationStep[];
  validation_checks?: ValidationCheck[];
  error_handling?: ErrorHandlingRule[];
  sample_inputs?: Record<string, unknown>;
  modal_function_name?: string;
  last_successful_execution?: string;
  last_failed_execution?: string;
  reliability_score?: number;
}

export interface ExecutionResult {
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
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'error';
  created_at: string;
  started_at?: string;
  completed_at?: string;
  execution_duration_seconds?: number;
  modal_call_id: string;
  error_message?: string;
  client_id?: string;
  execution_params?: Record<string, unknown>;
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
}

export interface LiveExecutionStatus {
  id: number;
  workflow_id: number;
  workflow_name: string;
  workflow_description: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
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
  client_id: string;
  estimated_seconds_remaining: number | null;
  steps_per_minute: number | null;
  runtime_seconds?: number;
} 