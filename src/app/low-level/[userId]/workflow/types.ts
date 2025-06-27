// Type aliases extracted from page.tsx for shared use across workflow module.
// Keeping them verbatim to avoid any behavioural changes.

export type Message = {
    id: string;
    sender: 'user' | 'ai' | 'ai-thinking';
    text: string;
};

export type CanvasContent = {
    id: number;
    title: string | null;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
    chat_history: Message[];
};

export type SynthesizedWorkflow = {
    title: string;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
};

import { FlattenedWorkflowAnalysis } from '@/types';

// Use the new flattened type that handles both legacy and JSONB data
export type WorkflowStepAnalysis = FlattenedWorkflowAnalysis;

export type FinalAnalysisData = {
    workflowNames?: string[];
    workflowContext?: WorkflowContext;
};

export type SynthesisStep = 'idle' | 'context_editing' | 'identifying' | 'workflow_editing' | 'defining_boundaries' | 'boundaries_editing' | 'synthesizing' | 'done' | 'refining';

export type WorkflowContext = {
    user_job_role: string;
    project_name: string;
    user_goal_from_recordings: string;
    overall_project_goal: string;
    overall_project_description: string;
};

export type WorkflowBoundary = {
    trigger: string;
    terminator: string;
};

export type WorkflowBoundaries = Record<string, WorkflowBoundary>;

export type WorkflowDataObject = {
    id: number;
    title: string;
    chat_history: {
        messages: Message[];
        synthesis_step: SynthesisStep;
        identified_workflow_names: string[];
        workflow_context: WorkflowContext;
        workflow_boundaries?: WorkflowBoundaries;
    };
};

export type DatabaseWorkflow = {
    id: number;
    title: string | null;
    inputs: string[];
    outputs: string[];
    steps: string[];
    business_logic: string[];
    chat_history: Message[];
};

export type SynthesisSession = {
    id: number;
    user_id: string;
    session_state: {
        messages: Message[];
        synthesis_step: SynthesisStep;
        identified_workflow_names: string[];
        draft_workflow_names?: string[];
        workflow_context: WorkflowContext;
        workflow_boundaries?: WorkflowBoundaries;
    };
};

export type LlmLabel = {
  id: number;
  created_at: string;
  user_id: string;
  low_level_workflow_analysis_id: number;
  suggested_labels: string[] | null;
  selected_labels: string[] | null;
}; 