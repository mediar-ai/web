export interface WorkflowContext {
  user_job_role: string;
  project_name: string;
  user_goal_from_recordings: string;
  overall_project_goal: string;
  overall_project_description: string;
  user_instructions: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'ai' | 'ai-thinking';
  text: string;
  isStep?: boolean;
  stepType?: string;
  workflowId?: number;
  isLoading?: boolean;
}

export interface CanvasContent {
  id: number;
  title: string;
  description: string;
  steps: {
    title: string;
    description: string;
    step_name?: string;
    substeps?: {
      substep_name: string;
      inputs: string[];
      outputs: string[];
      business_logic: string[];
    }[];
  }[];
  workflow_types: {
    name: string;
    description: string;
    type_name?: string;
    type_description?: string;
    conditions?: Record<string, unknown>;
  }[];
  workflow_instances: {
    name: string;
    description: string;
    instance_name?: string;
    instance_data?: Record<string, unknown>;
  }[];
  chat_history?: Message[];
}

export interface DatabaseWorkflow {
  id: number;
  user_id: string;
  title: string;
  chat_history?: Message[];
  detailed_workflow_data?: CanvasContent;
  created_at?: string;
}

export interface WorkflowBoundaries {
  [key: string]: {
    start_event_id: number | null;
    end_event_id: number | null;
    description: string;
    trigger?: string;
    terminator?: string;
  };
}

export type SynthesisStep = 'idle' | 'context_defined' | 'context_editing' | 'identifying' | 'workflows_selected' | 'workflow_editing' | 'defining_boundaries' | 'boundaries_defined' | 'boundaries_editing' | 'synthesizing' | 'synthesis_complete' | 'done' | 'timeline_complete';

export interface SynthesisSession {
  id: number;
  user_id: string;
  created_at: string;
  updated_at: string;
  session_state: {
    messages: Message[];
    synthesis_step: SynthesisStep;
    identified_workflow_names?: string[];
    workflow_context?: WorkflowContext;
    workflow_boundaries?: WorkflowBoundaries;
    draft_workflow_names?: string[];
    synthesized_workflows?: DetailedSynthesizedWorkflow[];
    final_analysis?: FinalAnalysisData;
  };
}

export interface DetailedSynthesizedWorkflow {
  id: number;
  title: string;
  description: string;
  steps: {
    title: string;
    description: string;
  }[];
  workflow_types: {
    name: string;
    description: string;
  }[];
  workflow_instances: {
    name: string;
    description: string;
  }[];
  chat_history: Message[];
}

export interface FinalAnalysisData {
  summary: string;
  next_steps: string;
  workflowNames?: string[];
  workflowContext?: WorkflowContext;
}

export interface RawEventAnalysis {
  analysis_id: number;
  user_id: string;
  raw_event_id: number;
  step_title: string;
  user_intent: string;
  step_summary: string;
  events_that_happened: string;
  how_content_changed: string;
  results_if_any: string;
  what_was_clicked: string;
  what_was_typed: string;
  window_title: string;
  created_at: string;
  event_payload?: Record<string, unknown>;
  event_created_at?: string;
}

export interface LlmLabel {
  id: number;
  label_name: string;
} 