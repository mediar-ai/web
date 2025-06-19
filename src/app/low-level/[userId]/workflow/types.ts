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

export type WorkflowStepAnalysis = {
    id: string;
    workflow: string;
    step: string;
    description: string;
    facts: string;
    logic: string;
    tech: string;
    apps: string;
    context: string;
    client_timestamp: string;
    created_at: string;
};

export type CombinedEvent = {
    analysis: WorkflowStepAnalysis;
    generated_output: string | null;
    feedback: 'good' | 'bad' | 'irrelevant' | null;
    contextSummary: {
        windowTitle: string;
        eventCount: number;
    };
    timestamp: Date;
};

export type FinalAnalysisData = {
    workflowNames?: string[];
    workflowContext?: WorkflowContext;
};

export type SynthesisStep = 'idle' | 'identifying' | 'workflow_editing' | 'defining_boundaries' | 'boundaries_editing' | 'synthesizing' | 'done' | 'refining';

export type WorkflowContext = {
    user_job_role: string;
    project_name: string;
    project_goal: string;
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
        workflow_context: WorkflowContext;
        workflow_boundaries?: WorkflowBoundaries;
    };
}; 