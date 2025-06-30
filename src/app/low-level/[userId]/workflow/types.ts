// Type aliases extracted from page.tsx for shared use across workflow module.
// Keeping them verbatim to avoid any behavioural changes.

export type Message = {
    id: string;
    sender: 'user' | 'ai' | 'ai-thinking';
    text: string;
};

export interface WorkflowContext {
    user_job_role: string;
    project_name: string;
    user_goal_from_recordings: string;
    overall_project_goal: string;
    overall_project_description: string;
}

export interface WorkflowBoundary {
    trigger: string;
    terminator: string;
}

export interface WorkflowBoundaries {
    [key: string]: WorkflowBoundary;
}

// Represents the full, detailed workflow object returned by the new synthesis process
export interface DetailedSynthesizedWorkflow {
    title: string;
    description: string;
    workflow_types: Array<{
        type_name: string;
        type_description: string;
        conditions: Record<string, unknown>;
    }>;
    workflow_instances: Array<{
        instance_name: string;
        instance_data: Record<string, unknown>;
    }>;
    steps: Array<{
        step_name: string;
        substeps: Array<{
            substep_name: string;
            inputs: string[];
            outputs: string[];
            business_logic: string[];
        }>;
    }>;
}

// Kept for backwards compatibility if needed, but new synthesis should use the detailed version
export interface SynthesizedWorkflow {
    title: string;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
}

export type CanvasContent = DetailedSynthesizedWorkflow & {
    id: number;
    chat_history: Message[];
    // Note: The old fields like 'inputs', 'outputs', 'businessLogic' at the top level are deprecated
    // in favor of the new nested structure within steps and substeps.
    // They can be kept for a transitional period if necessary.
};

import { FlattenedWorkflowAnalysis } from '@/types';

// Use the new flattened type that handles both legacy and JSONB data
export type WorkflowStepAnalysis = FlattenedWorkflowAnalysis;

export type FinalAnalysisData = {
    workflowNames?: string[];
    workflowContext?: WorkflowContext;
};

export type SynthesisStep = 'idle' | 'context_editing' | 'identifying' | 'workflow_editing' | 'defining_boundaries' | 'boundaries_editing' | 'synthesizing' | 'done' | 'refining';

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