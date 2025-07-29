'use client';
/* eslint-disable @typescript-eslint/no-unused-vars */


import { useUser } from '@/context/UserContext';
import type { Session, UserSessionData } from '@/lib/db';
import type { LowLevelEvent } from '@/types';
import { createRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    CanvasContent,
    DatabaseWorkflow,
    DetailedSynthesizedWorkflow,
    FinalAnalysisData,
    Message,
    SynthesisSession,
    SynthesisStep,
    WorkflowBoundaries,
    WorkflowContext
} from './types';

// Updated to match admin dashboard stats format using session metadata
type UserStats = {
  totalEvents: number;
  stepsProcessed: number;
  totalSteps: number;
  labelingTotal: number;
  llmGeneratedLabeled: number;
};

type CombinedAnalysisData = {
  id: string;
  client_timestamp: string;
  window_title: string;
  analysis_data: Record<string, unknown>;
  selected_labels: string[];
};

// Type definitions for batch timeline mapping
interface BatchMappingResult {
  batch_timestamp: string;
  analysis_id: number;
  event_mappings: EventMapping[];
  unrelated_events: UnrelatedEvent[];
}

interface EventMapping {
  raw_event_id: number;
  synthesized_workflow_step: string;
  confidence_score: number;
  user_action: string;
  ui_element_interacted?: string;
  content_change?: string;
}

interface UnrelatedEvent {
  raw_event_id: number;
  unrelated_reason: string;
}

// New interface for API response mappings
interface ApiResponseMapping {
  raw_event_id: number;
  analysis_id: number;
  confidence_score: number;
  workflow_type?: string;
  workflow_instance?: string;
  workflow_step?: string;
  workflow_substep?: string;
  inputs?: string;
  outputs?: string;
  business_logic?: string;
  unrelated_reason?: string;
}

interface ExtendedEventMapping extends EventMapping {
  batch_timestamp: string;
  analysis_id: number;
}

interface ExtendedUnrelatedEvent extends UnrelatedEvent {
  batch_timestamp: string;
}

interface TimelineAnnotation {
  id: number;
  raw_event_id: number;
  analysis_id: number;
  is_workflow_related: boolean;
  user_action: string;
  ui_element_interacted: string | null;
  content_change: string | null;
  synthesized_workflow_step: string | null;
  confidence_score: number;
  batch_timestamp: string;
  unrelated_reason?: string;
  created_at: string;
  // Additional properties needed by EditableTimelineMappings
  user_id?: string;
  model_used?: string;
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
  event_payload?: Record<string, unknown>;
  event_created_at?: string;
  selected_labels?: string[];
  suggested_labels?: string[];
}

export function useWorkflowPageLogic(userId: string) {
  const { setUserId } = useUser();
  const [view, setView] = useState<'initial' | 'chat_fullscreen' | 'canvas'>('initial');
  const [workflows, setWorkflows] = useState<CanvasContent[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: 'init', 
      sender: 'ai', 
      text: "Hi! I can help you synthesize workflows from raw user events. I'll analyze your recorded events and help identify distinct workflows.\n\nClick the button below to begin:"
    }
  ]);
  const [userInput, setUserInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [itemRefs, setItemRefs] = useState<Record<string, React.RefObject<HTMLTextAreaElement | null>[]>>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [synthesisStep, setSynthesisStep] = useState<SynthesisStep>('idle');
  const [workflowNames, setWorkflowNames] = useState<string[]>([]);
  const [identifiedWorkflowNames, setIdentifiedWorkflowNames] = useState<string[]>([]);
  const [draftWorkflowNames, setDraftWorkflowNames] = useState<string[]>([]);
  const [workflowBoundaries, setWorkflowBoundaries] = useState<WorkflowBoundaries>({});
  const [collapsedSections, setCollapsedSections] = useState({
    inputs: true,
    outputs: true,
    steps: true,
    businessLogic: true,
  });
  const [synthesisSessionId, setSynthesisSessionId] = useState<string | null>(null);
  const [workflowContext, setWorkflowContext] = useState<WorkflowContext>({
    user_job_role: '',
    project_name: '',
    user_goal_from_recordings: '',
    overall_project_goal: '',
    overall_project_description: '',
    user_instructions: '',
  });
  const [editableContext, setEditableContext] = useState<WorkflowContext>({
    user_job_role: '',
    project_name: '',
    user_goal_from_recordings: '',
    overall_project_goal: '',
    overall_project_description: '',
    user_instructions: '',
  });
  const [isAnalyzingEvents, setIsAnalyzingEvents] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isFetchingEvents, setIsFetchingEvents] = useState(true);
  const [timelineEvents, setTimelineEvents] = useState<Record<string, unknown>[]>([]);
  const [timelineMappingMode, setTimelineMappingMode] = useState(false);
  const [lowLevelEvents, setLowLevelEvents] = useState<LowLevelEvent[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [isMappingTimeline, setIsMappingTimeline] = useState(false);
  const [timelineAnnotations, setTimelineAnnotations] = useState<TimelineAnnotation[] | null>(null);
  
  // Timeline mapping progress tracking (similar to analyze context)
  const [timelineMappingStatus, setTimelineMappingStatus] = useState("");
  const [timelineMappingProgress, setTimelineMappingProgress] = useState(0);
  const [timelineMappingElapsedTime, setTimelineMappingElapsedTime] = useState(0);
  const timelineMappingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [timelineMappingBatch, setTimelineMappingBatch] = useState<{current: number, total: number} | null>(null);
  
  // Orchestration state for the new full process
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [orchestrationStatus, setOrchestrationStatus] = useState("");
  const [orchestrationProgress, setOrchestrationProgress] = useState(0);
  const [orchestrationElapsedTime, setOrchestrationElapsedTime] = useState(0);
  const orchestrationTimerRef = useRef<NodeJS.Timeout | null>(null);
  


  // Time boundary state for filtering workflow synthesis data
  const [timeBoundary, setTimeBoundary] = useState<{startDate: Date | null; endDate: Date | null}>({
    startDate: null,
    endDate: null
  });
  
  // Data is now fetched directly by backend APIs - frontend only handles stats and UI state

  const isLoading = useMemo(() => 
    isFetchingEvents || isAnalyzingEvents || isMappingTimeline || isOrchestrating
  , [isFetchingEvents, isAnalyzingEvents, isMappingTimeline, isOrchestrating]);

  // Refs for chat scroll containers
  const fullscreenChatRef = useRef<HTMLDivElement>(null);
  const sidebarChatRef = useRef<HTMLDivElement>(null);

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Scroll chat to bottom
  const scrollToBottom = useCallback(() => {
    if (fullscreenChatRef.current) {
      fullscreenChatRef.current.scrollTop = fullscreenChatRef.current.scrollHeight;
    }
    if (sidebarChatRef.current) {
      sidebarChatRef.current.scrollTop = sidebarChatRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages, scrollToBottom]);

  const saveSynthesisSession = useCallback(async (
    messagesToSave: Message[], 
    step: SynthesisStep, 
    workflowNames: string[], 
    context: WorkflowContext | null,
    boundaries: WorkflowBoundaries | null,
    draftNames?: string[] | null
  ) => {
    if (!userId) return;

    const sessionState = {
      messages: messagesToSave,
      synthesis_step: step,
      identified_workflow_names: workflowNames,
      draft_workflow_names: draftNames,
      workflow_context: context,
      workflow_boundaries: boundaries,
    };

    const method = synthesisSessionId ? 'PUT' : 'POST';
    const url = synthesisSessionId ? `/api/synthesis-sessions/${synthesisSessionId}` : '/api/synthesis-sessions';
    
    const body = synthesisSessionId 
      ? JSON.stringify({ session_state: sessionState })
      : JSON.stringify({ userId: userId, session_state: sessionState });

    try {
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: body
      });

      if (response.ok) {
        const result = await response.json();
        if (!synthesisSessionId && result.data) {
          setSynthesisSessionId(result.data.id);
        }
      } else {
        const errorText = await response.text();
        if (response.status === 404 && synthesisSessionId) {
          setSynthesisSessionId(null);
        } else {
          console.error("Failed to save synthesis session:", response.status, errorText);
        }
      }
    } catch (error) {
      console.error("Error saving synthesis session:", error);
    }
  }, [userId, synthesisSessionId]);

  const loadSynthesisSession = useCallback(async () => {
    if (!userId) return;
    
    try {
      const response = await fetch(`/api/synthesis-sessions?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        const session: SynthesisSession = result.data;

        if (session) {
          const loadedMessages = Array.isArray(session.messages) ? session.messages : [];
          if (loadedMessages.length > 0) setMessages(loadedMessages);
          
          setSynthesisStep(session.synthesis_step || 'idle');
          setWorkflowNames(session.identified_workflow_names || []);
          setSynthesisSessionId(session.synthesis_session_id);

          if (session.workflow_context) {
            setWorkflowContext(session.workflow_context);
            setEditableContext(session.workflow_context);
          }
          
          if (session.workflow_boundaries) {
            setWorkflowBoundaries(session.workflow_boundaries);
          }
        }
      } else if (response.status !== 404) {
        console.error("Failed to load synthesis session, status:", response.status);
      }
    } catch (error) {
      console.error('[WORKFLOW_DEBUG] Error loading synthesis session:', error);
    }
  }, [userId]);

  useEffect(() => {
    setUserId(userId);
    loadSynthesisSession();
    fetchCompleteWorkflows(); // Load complete workflows with detailed data

    const fetchUserStats = async () => {
      if (!userId) return;
      try {
        // Use same session data source as admin dashboard
        const response = await fetch(`/api/sessions`);
        if (response.ok) {
          const allSessionData: Record<string, UserSessionData> = await response.json();
          
          // Find this user's data
          const userData = Object.entries(allSessionData).find(([sessionUserId]) => sessionUserId === userId)?.[1];
          
          if (userData) {
            // Calculate stats same way as admin dashboard
            const totalEvents = userData.sessions.reduce((sum: number, s: Session) => sum + (s.eventCount || 0), 0);
            const totalProcessedEvents = userData.sessions.reduce((sum: number, s: Session) => sum + (s.processed_event_count || 0), 0);
            const totalUiSteps = userData.sessions.reduce((sum: number, s: Session) => sum + (s.total_ui_steps || 0), 0);
            const totalLlmLabeledSteps = userData.sessions.reduce((sum: number, s: Session) => sum + (s.llm_labeled_steps || 0), 0);
            const totalHumanAnnotatedSteps = userData.sessions.reduce((sum: number, s: Session) => sum + (s.human_annotated_steps || 0), 0);

            const stats: UserStats = {
              totalEvents: totalEvents,
              stepsProcessed: totalProcessedEvents, // processed events = workflow analyses completed
              totalSteps: totalUiSteps, // UI steps, not all events
              labelingTotal: totalLlmLabeledSteps, // LLM labeled steps from session metadata
              llmGeneratedLabeled: totalHumanAnnotatedSteps, // Human annotated steps
            };
            
            setUserStats(stats);
          } else {
            console.warn(`User ${userId} not found in session data`);
          }
        } else {
          console.error("Failed to fetch session data");
        }
      } catch (error) {
        console.error("Error fetching user stats:", error);
      }
    };

    // Data fetching moved to backend APIs - frontend only loads stats
    setIsFetchingEvents(false);
    fetchUserStats();
  }, [userId, setUserId, loadSynthesisSession]);

  useEffect(() => {
    const newRefs: Record<string, React.RefObject<HTMLTextAreaElement | null>[]> = {};
    workflows.forEach((wf, wfIndex) => {
      Object.keys(wf).forEach(key => {
        const field = key as keyof CanvasContent;
        if (Array.isArray(wf[field])) {
          const fieldKey = `${wfIndex}-${field}`;
          newRefs[fieldKey] = (wf[field] as string[]).map(() => createRef());
        }
      });
    });
    setItemRefs(newRefs);
  }, [workflows]);

  useEffect(() => {
    // This logic is no longer needed as the tabbed view is removed.
    // if (synthesisStep === 'done') {
    //   if (activeWorkflowIndex >= 0 && workflows[activeWorkflowIndex]) {
    //     setMessages(workflows[activeWorkflowIndex].chat_history);
    //   }
    // } else if(synthesisStep === 'idle' && workflows.length === 0) {
    //   // Do nothing, keep initial message
    // }
    // If synthesisStep is not 'done', messages are managed by the synthesis process itself 
    // (e.g., loadSynthesisSession, handleSendMessage) and should not be overwritten by the generic workflows list loading.
  }, [workflows]);

  const fetchWorkflows = useCallback(async (skipLoadingState = false) => {
    if(!userId) return;
    try {
      const response = await fetch(`/api/workflows?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        const regularWorkflows = result.data
          .filter((d: DatabaseWorkflow) => d.title !== '__CONVERSATION__')
          .map((workflow: DatabaseWorkflow) => {
            // Transform to CanvasContent format for component compatibility
            if (workflow.detailed_workflow_data) {
              return {
                ...workflow.detailed_workflow_data, // Spread to top level for direct access
                id: workflow.id, // Override with database workflow ID
                chat_history: workflow.chat_history || []
              };
            } else {
              // Handle case where detailed_workflow_data is null (shouldn't happen for new workflows)
              console.warn('Workflow missing detailed_workflow_data:', workflow.id);
              return {
                id: workflow.id,
                title: workflow.title || 'Untitled Workflow',
                description: 'Workflow data unavailable',
                steps: [],
                workflow_types: [],
                workflow_instances: [],
                chat_history: workflow.chat_history || []
              };
            }
          });
        setWorkflows(regularWorkflows);
      }
    } catch (error) {
      console.error('[WORKFLOW_DEBUG] Failed to fetch workflows:', error);
    }
  }, [userId, synthesisStep]);
  
  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const runInitialAnalysis = async () => {
    setIsAnalyzingEvents(true);
    setAnalysisStatus("Analyzing context and drafting workflows...");
    setAnalysisProgress(0);
    setElapsedTime(0);
    setIsAiThinking(true);
    timerRef.current = setInterval(() => setElapsedTime(prevTime => prevTime + 0.1), 100);

    try {
      const response = await fetch('/api/initiate-workflow-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: userId,
          model: selectedModel,
          ...(timeBoundary.startDate && timeBoundary.endDate && {
            startDate: timeBoundary.startDate.toISOString(),
            endDate: timeBoundary.endDate.toISOString()
          })
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || `API Error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const finalData: FinalAnalysisData = {
        summary: '',
        next_steps: ''
      };

      const processChunk = (chunk: string) => {
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.substring(5));
            if (parsed.error) {
              throw new Error(parsed.details || parsed.error);
            }
            if (parsed.status) setAnalysisStatus(parsed.status);
            if (typeof parsed.progress === 'number') setAnalysisProgress(parsed.progress);
            if (parsed.data?.workflowNames) finalData.workflowNames = parsed.data.workflowNames;
            if (parsed.data?.workflowContext) finalData.workflowContext = parsed.data.workflowContext;
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== '') {
              throw parseError;
            }
            // Ignore JSON parsing errors for malformed chunks
          }
        }
      };
      
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        parts.forEach(processChunk);
      }
      processChunk(buffer);

      const defaultContext: WorkflowContext = { 
        user_job_role: '', 
        project_name: '', 
        user_goal_from_recordings: '', 
        overall_project_goal: '', 
        overall_project_description: '',
        user_instructions: editableContext?.user_instructions || ''
      };
      const newContext = finalData.workflowContext || defaultContext;
      // Preserve user_instructions from current editableContext
      const preservedContext = {
        ...newContext,
        user_instructions: editableContext?.user_instructions || newContext.user_instructions || ''
      };
      setWorkflowContext(preservedContext);
      setEditableContext(preservedContext);
      setWorkflowNames(finalData.workflowNames || []);
      setSynthesisStep('context_editing');

      await saveSynthesisSession(
        [], 'context_editing', [], preservedContext, null, finalData.workflowNames || []
      );

    } catch (error) {
      console.error("Error during initial analysis:", error);
      let errorMessage = "Sorry, I encountered an error. Please try again.";
      
      if (error instanceof Error) {
        if (error.message.includes('quota') || error.message.includes('429') || error.message.includes('Too Many Requests')) {
          errorMessage = "API quota exceeded. Please try again later or check your API key limits.";
        } else if (error.message.includes('Failed to parse generative model response')) {
          errorMessage = "The AI service is currently experiencing issues. Please try again in a few minutes.";
        } else if (error.message.includes('API Error:')) {
          errorMessage = `API Error: ${error.message}`;
        } else {
          errorMessage = `Error: ${error.message}`;
        }
      }
      
      setMessages([{ id: `error-${Date.now()}`, sender: 'ai', text: errorMessage }]);
      setSynthesisStep('idle'); // Reset to idle state so user can try again
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsAnalyzingEvents(false);
      setIsAiThinking(false);
    }
  };
  
  const refineAndIdentifyWorkflows = async () => {
    setSynthesisStep('identifying');

    try {
      const response = await fetch('/api/refine-workflow-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          userId: userId,
          workflow_context: editableContext,
          draft_workflow_names: workflowNames,
          ...(timeBoundary.startDate && timeBoundary.endDate && {
            startDate: timeBoundary.startDate.toISOString(),
            endDate: timeBoundary.endDate.toISOString()
          })
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refine workflow list');
      }

      const result = await response.json();
      setWorkflowNames(result.refined_workflow_names || []);
      setSynthesisStep('workflow_editing');

      await saveSynthesisSession(
        messages,
        'workflow_editing',
        result.refined_workflow_names || [],
        workflowContext,
        workflowBoundaries,
        workflowNames
      );
    } catch (error) {
      console.error('Error refining workflows:', error);
      setMessages(prev => [...prev, {id: 'error-refine', sender: 'ai', text: 'An error occurred while refining workflows.'}]);
      setSynthesisStep('context_editing'); // Revert to previous step
    }
  };

  const processAllWorkflows = async (approvedWorkflows: string[]) => {
    setSynthesisStep('defining_boundaries');
    const thinkingId = `ai-thinking-${Date.now()}`;
    const updatedMessages: Message[] = [...messages, { id: thinkingId, sender: 'ai-thinking', text: '...' }];
    setMessages(updatedMessages);
    await saveSynthesisSession(updatedMessages, 'defining_boundaries', approvedWorkflows, workflowContext, workflowBoundaries, workflowNames);

    try {
      const response = await fetch('/api/define-workflow-boundaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          context: {
            workflows: approvedWorkflows.map(name => ({ workflow_name: name })),
            userId: userId,
            userContext: workflowContext,
            userInstructions: workflowContext?.user_instructions,
          },
          ...(timeBoundary.startDate && timeBoundary.endDate && {
            startDate: timeBoundary.startDate.toISOString(),
            endDate: timeBoundary.endDate.toISOString()
          })
        })
      });

      if (!response.ok) throw new Error('Failed to define workflow boundaries');
      
      const boundariesResponse = await response.json();
      
      // Transform from API format { workflows: [{ workflow_name, trigger, terminator }] }
      // to UI format { [workflowName]: { trigger, terminator } }
      const transformedBoundaries: WorkflowBoundaries = {};
      if (boundariesResponse.workflows) {
        boundariesResponse.workflows.forEach((workflow: { workflow_name: string; trigger: string; terminator: string }) => {
          transformedBoundaries[workflow.workflow_name] = {
            start_event_id: null,
            end_event_id: null,
            description: '',
            trigger: workflow.trigger,
            terminator: workflow.terminator
          };
        });
      } else {
        // Handle case where API returns object format directly (fallback)
        Object.keys(boundariesResponse).forEach((workflowName) => {
          if (boundariesResponse[workflowName] && typeof boundariesResponse[workflowName] === 'object') {
            transformedBoundaries[workflowName] = boundariesResponse[workflowName];
          }
        });
      }
      
      setWorkflowBoundaries(transformedBoundaries);
      setSynthesisStep('boundaries_editing');
      
      const boundariesMessage: Message = { 
        id: `${Date.now()}`, sender: 'ai', text: "I've defined boundaries for your workflows. Please review and approve them above."
      };
      setMessages(prev => [...prev.slice(0, -1), boundariesMessage]);
      await saveSynthesisSession(messages.slice(0, -1).concat([boundariesMessage]), 'boundaries_editing', approvedWorkflows, workflowContext, transformedBoundaries, workflowNames);

    } catch (error) {
      console.error("Error defining workflow boundaries:", error);
      setMessages(prev => [...prev.slice(0, -1), { id: `error-${Date.now()}`, sender: 'ai', text: "Sorry, an error occurred while defining boundaries." }]);
      await saveSynthesisSession(messages, 'workflow_editing', approvedWorkflows, workflowContext, workflowBoundaries, workflowNames);
    }
  };

  const generateAndSaveTimelineMapping = async () => {
    if (!workflows.length) {
      alert("No workflows available for timeline mapping");
      return;
    }

    // Transition to done state when user clicks timeline mapping
    setSynthesisStep('done');

    // Initialize empty array instead of null to show table immediately
    setTimelineAnnotations([]);
    setIsMappingTimeline(true);
    setTimelineMappingStatus("Initializing timeline mapping...");
    setTimelineMappingProgress(0);
    setTimelineMappingElapsedTime(0);
    setTimelineMappingBatch(null);
    
    // Start timer for elapsed time tracking
    timelineMappingTimerRef.current = setInterval(() => 
      setTimelineMappingElapsedTime(prevTime => prevTime + 0.1), 100
    );

    console.log('Starting sequential batch timeline mapping for', workflows.length, 'workflows');

    try {
      const requestBody = { 
        userId: userId,
        model: selectedModel,
        synthesis_session_id: synthesisSessionId, // Link to current session
        ...(timeBoundary.startDate && timeBoundary.endDate && {
          startDate: timeBoundary.startDate.toISOString(),
          endDate: timeBoundary.endDate.toISOString()
        })
      };

      const response = await fetch('/api/analyze-raw-timeline-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || `API Error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const allAnnotations: TimelineAnnotation[] = [];

      const processChunk = (chunk: string) => {
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.substring(5));
            if (parsed.error) {
              throw new Error(parsed.details || parsed.error);
            }
            
            // Handle initial table setup
            if (parsed.data?.initializeTable) {
              setTimelineAnnotations([]);
            }
            
            // Handle batch information for better progress tracking
            if (parsed.data?.currentBatch && parsed.data?.totalBatches) {
              const batchInfo = { current: parsed.data.currentBatch, total: parsed.data.totalBatches };
              setTimelineMappingBatch(batchInfo);
              
              // Calculate more accurate progress based on batch info
              const batchProgress = (parsed.data.currentBatch - 1) / parsed.data.totalBatches * 100;
              setTimelineMappingProgress(Math.round(batchProgress));
              
              // Enhanced status message with batch information
              if (parsed.status) {
                setTimelineMappingStatus(parsed.status);
              }
            } else {
              // Fallback to original behavior if no batch info
              if (parsed.status) setTimelineMappingStatus(parsed.status);
              if (typeof parsed.progress === 'number') setTimelineMappingProgress(parsed.progress);
            }
            
            // Always process annotations array (even if empty) to ensure UI updates
            if (parsed.data && 'annotations' in parsed.data) {
              const newAnnotations = parsed.data.annotations || [];
              if (newAnnotations.length > 0) {
                allAnnotations.push(...newAnnotations);
                // Update UI with incremental results
                setTimelineAnnotations([...allAnnotations]);
                console.log(`📊 Updated UI with ${newAnnotations.length} new annotations. Total: ${allAnnotations.length}`);
              } else {
                // Even for empty batches, update the UI to show the processing is active
                setTimelineAnnotations([...allAnnotations]);
                console.log(`📊 Processed empty batch. Total annotations: ${allAnnotations.length}`);
              }
            }
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== '') {
              throw parseError;
            }
            // Ignore JSON parsing errors for malformed chunks
          }
        }
      };
      
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        parts.forEach(processChunk);
      }
      processChunk(buffer);

      // Final update with all annotations
      setTimelineAnnotations(allAnnotations);
      setTimelineMappingProgress(100);
      setTimelineMappingStatus(`Completed! Generated ${allAnnotations.length} timeline mappings`);
      setTimelineMappingBatch(null);
      console.log(`🎉 Timeline mapping completed! Total mappings: ${allAnnotations.length}`);

    } catch (error) {
      console.error("Error during timeline mapping:", error);
      let errorMessage = "Timeline mapping failed. Please try again.";
      
      if (error instanceof Error) {
        if (error.message.includes('quota') || error.message.includes('429') || error.message.includes('Too Many Requests')) {
          errorMessage = "API quota exceeded. Please try again later or check your API key limits.";
        } else if (error.message.includes('Failed to parse generative model response')) {
          errorMessage = "The AI service is currently experiencing issues. Please try again in a few minutes.";
        } else if (error.message.includes('API Error:')) {
          errorMessage = `API Error: ${error.message}`;
        } else {
          errorMessage = `Error: ${error.message}`;
        }
      }
      
      setTimelineMappingStatus(errorMessage);
    } finally {
      // Clean up timer
      if (timelineMappingTimerRef.current) {
        clearInterval(timelineMappingTimerRef.current);
        timelineMappingTimerRef.current = null;
      }
      setIsMappingTimeline(false);
      setTimelineMappingBatch(null);
    }
  };

  const proceedToSynthesis = async (approvedBoundaries: WorkflowBoundaries) => {
    setSynthesisStep('synthesizing');
    const thinkingId = `ai-thinking-${Date.now()}`;
    const updatedMessages: Message[] = [...messages, { id: thinkingId, sender: 'ai-thinking', text: '...' }];
    setMessages(updatedMessages);
    await saveSynthesisSession(updatedMessages, 'synthesizing', workflowNames, workflowContext, approvedBoundaries, workflowNames);

    try {
      // STEP 1: Call the original /api/synthesize-workflow endpoint
      const synthesisResponse = await fetch('/api/synthesize-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          context: {
            workflows: workflowNames.map(name => ({
              name: name,
              trigger: approvedBoundaries[name]?.trigger || '',
              terminator: approvedBoundaries[name]?.terminator || '',
            })),
            userId: userId,
            workflowContext: workflowContext,
            userInstructions: workflowContext?.user_instructions,
          },
          // Add time boundaries if they exist
          ...(timeBoundary.startDate && timeBoundary.endDate && {
            startDate: timeBoundary.startDate.toISOString(),
            endDate: timeBoundary.endDate.toISOString()
          })
        }),
      });

      if (!synthesisResponse.ok) {
        const errorData = await synthesisResponse.json();
        throw new Error(errorData.details || 'Failed to synthesize workflows');
      }

      const result = await synthesisResponse.json();
      console.log('DEBUG: Frontend received synthesis result:', JSON.stringify(result, null, 2));
      console.log('DEBUG: result.workflows:', result.workflows);
      const synthesizedWorkflows = result.workflows || [];
      console.log('DEBUG: synthesizedWorkflows length:', synthesizedWorkflows.length);
      
      // STEP 2: Save the newly synthesized workflows to the database
      // This will assign them IDs, which we'll need for the next step.
      const savedWorkflows = await saveSynthesizedWorkflows(synthesizedWorkflows);

      // STEP 3: Update the UI to show the generated workflows on the canvas with complete data
      // Re-fetch from database to ensure we have detailed_workflow_data for timeline mapping
      await fetchCompleteWorkflows();
      
      setSynthesisStep('synthesis_complete');
      const synthesizedMessage: Message = {
        id: `${Date.now()}`, 
        sender: 'ai', 
        text: `Successfully synthesized ${savedWorkflows.length} workflows! You can now review and edit them on the canvas, then proceed to timeline mapping.`
      };
      const finalMessages = [...updatedMessages.slice(0, -1), synthesizedMessage];
      setMessages(finalMessages);
      await saveSynthesisSession(finalMessages, 'synthesis_complete', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);

    } catch (error) {
      console.error("Error during workflow synthesis:", error);
      setMessages(prev => [...prev.slice(0, -1), { 
        id: `error-${Date.now()}`, 
        sender: 'ai', 
        text: `Sorry, I encountered an error during workflow synthesis: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }]);
      setSynthesisStep('boundaries_editing');
      await saveSynthesisSession(messages, 'boundaries_editing', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);
    }
  };

  const fetchCompleteWorkflows = async () => {
    if (!userId) return;
    
    try {
      const response = await fetch(`/api/workflows?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        if (result.data && Array.isArray(result.data)) {
          // Transform database records to CanvasContent format
          const transformedWorkflows = result.data
            .filter((d: DatabaseWorkflow) => d.title !== '__CONVERSATION__')
            .map((workflow: DatabaseWorkflow) => {
              if (workflow.detailed_workflow_data) {
                // Spread detailed_workflow_data to top level for component access
                return {
                  ...workflow.detailed_workflow_data, // Extract steps, workflow_types, etc. to top level
                  id: workflow.id, // Override with database workflow ID
                  chat_history: workflow.chat_history || []
                };
              } else {
                // Handle case where detailed_workflow_data is null
                console.warn('Workflow missing detailed_workflow_data:', workflow.id);
                return {
                  id: workflow.id,
                  title: workflow.title || 'Untitled Workflow',
                  description: 'Workflow data unavailable',
                  steps: [],
                  workflow_types: [],
                  workflow_instances: [],
                  chat_history: workflow.chat_history || []
                };
              }
            });
          setWorkflows(transformedWorkflows);
        }
      } else {
        console.error('Failed to fetch complete workflows:', response.status);
      }
    } catch (error) {
      console.error('Error fetching complete workflows:', error);
    }
  };

  const saveSynthesizedWorkflows = async (synthesizedWorkflows: DetailedSynthesizedWorkflow[]) => {
    if (!userId || synthesizedWorkflows.length === 0) return [];

    const recordsToInsert = synthesizedWorkflows.map(workflow => ({
      title: workflow.title || 'Untitled Workflow',
      detailed_workflow_data: workflow, // Store the complete new structure
      chat_history: [{id: '1', sender: 'ai', text: 'Workflow synthesized.'}],
      synthesis_session_id: synthesisSessionId,
    }));

    try {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, workflows: recordsToInsert })
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save workflows: ${response.status}`);
      }
      
      const savedWorkflows = await response.json();
      return savedWorkflows.data || [];
    } catch (error) {
      console.error("Error saving synthesized workflows:", error);
      return [];
    }
  };

  useEffect(() => {
    if (workflowContext) {
      // Preserve user_instructions from current editableContext when workflowContext updates
      setEditableContext(prevEditableContext => ({
        ...workflowContext,
        user_instructions: prevEditableContext?.user_instructions || workflowContext.user_instructions || ''
      }));
    }
  }, [workflowContext]);

  const handleContextChange = useCallback((field: keyof WorkflowContext, value: string) => {
    if (editableContext) {
      const updatedContext = { ...editableContext, [field]: value };
      setEditableContext(updatedContext);
      setWorkflowContext(updatedContext);
      
      // Auto-save context changes with debouncing
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      
      saveTimeoutRef.current = setTimeout(async () => {
        await saveSynthesisSession(
          messages,
          synthesisStep,
          identifiedWorkflowNames,
          updatedContext,
          workflowBoundaries,
          draftWorkflowNames
        );
      }, 1000); // 1 second debounce
    }
  }, [editableContext, messages, synthesisStep, identifiedWorkflowNames, workflowBoundaries, draftWorkflowNames, saveSynthesisSession]);

  const handleWorkflowsChange = useCallback(async (updatedWorkflows: CanvasContent[]) => {
    setWorkflows(updatedWorkflows);
    
    // Auto-save the updated workflows to the database
    try {
      const workflowIds = updatedWorkflows.map(w => w.id);
      
      // Update each workflow in the database
      const updatePromises = updatedWorkflows.map(async (workflow) => {
        const response = await fetch(`/api/workflows/${workflow.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            title: workflow.title || 'Untitled Workflow',
            detailed_workflow_data: workflow
          })
        });
        
        if (!response.ok) {
          console.error(`Failed to update workflow ${workflow.id}:`, response.status);
        }
        
        return response.ok;
      });
      
      const results = await Promise.all(updatePromises);
      const successCount = results.filter(Boolean).length;
      
      console.log(`Auto-saved ${successCount}/${updatedWorkflows.length} workflows`);
      
      // Also save to synthesis session if we have one
      if (synthesisSessionId) {
        await saveSynthesisSession(
          messages,
          synthesisStep,
          identifiedWorkflowNames,
          workflowContext,
          workflowBoundaries,
          draftWorkflowNames
        );
      }
    } catch (error) {
      console.error('Error auto-saving workflows:', error);
    }
  }, [userId, synthesisSessionId, messages, synthesisStep, identifiedWorkflowNames, workflowContext, workflowBoundaries, draftWorkflowNames, saveSynthesisSession]);

  const handleTimelineAnnotationsChange = useCallback(async (updatedAnnotations: TimelineAnnotation[]) => {
    setTimelineAnnotations(updatedAnnotations);
    
    // Auto-save the updated timeline annotations to the database
    try {
      // Update each annotation in the database
      const updatePromises = updatedAnnotations.map(async (annotation) => {
        const response = await fetch(`/api/timeline-event-mappings/${annotation.analysis_id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            annotation: annotation
          })
        });
        
        if (!response.ok) {
          console.error(`Failed to update timeline annotation ${annotation.analysis_id}:`, response.status);
        }
        
        return response.ok;
      });
      
      const results = await Promise.all(updatePromises);
      const successCount = results.filter(Boolean).length;
      
      console.log(`Auto-saved ${successCount}/${updatedAnnotations.length} timeline annotations`);
      
    } catch (error) {
      console.error('Error auto-saving timeline annotations:', error);
    }
  }, [userId]);

  const resetConversation = async () => {
    setIsAiThinking(true);
    
    const initialMessages: Message[] = [
      { 
        id: 'init', 
        sender: 'ai', 
        text: "Hi! I can help you synthesize workflows from raw user events. I'll analyze your recorded events and help identify distinct workflows.\n\nClick the button below to begin:"
      }
    ];
    
    setMessages(initialMessages);
          setWorkflows([]);
    setSynthesisStep('idle');
    setIdentifiedWorkflowNames([]);
    setDraftWorkflowNames([]);
    const emptyContext: WorkflowContext = { user_job_role: '', project_name: '', user_goal_from_recordings: '', overall_project_goal: '', overall_project_description: '', user_instructions: '' };
    setWorkflowContext(emptyContext);
    setEditableContext(emptyContext);
    setWorkflowBoundaries({});
    // Reset draft event mapping when resetting conversation
    setTimelineAnnotations(null);

    if (synthesisSessionId) {
      try {
        await fetch(`/api/synthesis-sessions/${synthesisSessionId}`, { method: 'DELETE' });
        
        // Also clean up draft timeline annotations for this session
        await fetch('/api/timeline-event-mappings/cleanup-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            userId, 
            synthesis_session_id: synthesisSessionId 
          })
        });
        
        await saveSynthesisSession(initialMessages, 'idle', [], emptyContext, null, []);
      } catch (error) {
        console.error('Error resetting conversation:', error);
      }
    } else {
      await saveSynthesisSession(initialMessages, 'idle', [], emptyContext, null, []);
    }
    
    // FIX: Don't clear session ID after creating new session - let saveSynthesisSession set it
    // setSynthesisSessionId(null);
    await fetchCompleteWorkflows();
    setIsAiThinking(false);
  };

  const deleteAllWorkflows = async () => {
    setIsAiThinking(true);
    
    try {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      
      const response = await fetch(`/api/workflows/delete-all?userId=${userId}`, { 
        method: 'DELETE' 
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete workflows: ${response.statusText}`);
      }
      
      if (synthesisSessionId) {
        try {
          await fetch(`/api/synthesis-sessions/${synthesisSessionId}`, { method: 'DELETE' });
        } catch (sessionError) {
          console.error('Error deleting synthesis session:', sessionError);
        }
      }
      
      const initialMessages: Message[] = [
        { 
          id: 'init', 
          sender: 'ai', 
          text: "Hi! I can help you synthesize workflows from raw user events. I'll analyze your recorded events and help identify distinct workflows.\n\nClick the button below to begin:"
        }
      ];
      
      setMessages(initialMessages);
              setWorkflows([]);
      setSynthesisStep('idle');
      setIdentifiedWorkflowNames([]);
      setDraftWorkflowNames([]);
      const emptyContext: WorkflowContext = { user_job_role: '', project_name: '', user_goal_from_recordings: '', overall_project_goal: '', overall_project_description: '', user_instructions: '' };
      setWorkflowContext(emptyContext);
      setEditableContext(emptyContext);
      setWorkflowBoundaries({});
      setSynthesisSessionId(null);
      
    } catch (error) {
      console.error('Error deleting all workflows:', error);
    } finally {
      setIsAiThinking(false);
    }
  };

  const saveSynthesis = async (name?: string) => {
    if (!workflows || workflows.length === 0) {
      console.error('No workflows to save');
      return { success: false, message: 'No workflows to save' };
    }

    try {
      const workflowIds = workflows.map(w => w.id);
      
      // Include current session state in the save request
      const currentSessionState = {
        workflow_context: editableContext,
        identified_workflow_names: identifiedWorkflowNames,
        workflow_boundaries: workflowBoundaries,
        messages: messages,
        synthesis_step: synthesisStep,
        synthesized_workflows: workflows
      };
      
      const response = await fetch('/api/workflows/save-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workflowIds, 
          userId,
          name, // Optional custom name for the synthesis
          sessionState: currentSessionState // Include current session state
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save synthesis');
      }

      const result = await response.json();
      console.log(`Saved synthesis: ${result.message}`);
      
      // Refresh workflows to show updated status
      await fetchWorkflows(true);
      
      return { success: true, message: result.message };
    } catch (error) {
      console.error('Error saving synthesis:', error);
      return { success: false, message: 'Failed to save synthesis' };
    }
  };

  const goBackToWorkflowEditing = () => {
    setSynthesisStep('workflow_editing');
  };

  const confirmBoundaries = () => {
    proceedToSynthesis(workflowBoundaries);
  };

  // Load existing timeline annotations for current session
  useEffect(() => {
    const loadExistingTimelineAnnotations = async () => {
      try {
        console.log('Loading timeline annotations for current session...');
        
        // Build query params for session-aware loading
        const params = new URLSearchParams({
          user_id: userId,
          raw_events: 'true',
          include_unrelated: 'true',
        });
        
        // If we have a synthesis session, only load annotations for that session
        if (synthesisSessionId) {
          params.append('synthesis_session_id', synthesisSessionId);
        } else {
          // Otherwise only load draft annotations (current session work)
          params.append('include_saved', 'false');
        }
        
        const response = await fetch(`/api/timeline-event-mappings?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.annotations && data.annotations.length > 0) {
            setTimelineAnnotations(data.annotations);
            console.log('Loaded timeline annotations for current session:', data.annotations.length);
          } else {
            console.log('ℹ️ No timeline annotations found for current session');
            setTimelineAnnotations([]);
          }
        } else {
          console.log('ℹ️ Failed to fetch timeline annotations');
          setTimelineAnnotations([]);
        }
      } catch (error) {
        console.log('ℹ️ Error loading timeline annotations:', error);
        setTimelineAnnotations([]);
      }
    };
    
    if (userId) {
      loadExistingTimelineAnnotations();
    }
  }, [userId, synthesisSessionId]); // Re-load when session changes

  // Load existing synthesis session on page load
  useEffect(() => {
    // Set user ID and mark fetching as complete since we don't fetch events on this page
    setUserId(userId);
    setIsFetchingEvents(false);
  }, [userId, setUserId]);

  const runFullProcess = async () => {
    if (!timeBoundary.startDate || !timeBoundary.endDate) {
      alert("Please select a time boundary first.");
      return;
    }
    
    setIsOrchestrating(true);
    setOrchestrationStatus("Starting 5-step workflow orchestration...");
    setOrchestrationProgress(0);
    setOrchestrationElapsedTime(0);
    
    if (orchestrationTimerRef.current) {
      clearInterval(orchestrationTimerRef.current);
    }
    orchestrationTimerRef.current = setInterval(() => setOrchestrationElapsedTime(prev => prev + 1), 1000);

    try {
      const response = await fetch('/api/workflows/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          model: selectedModel,
          startDate: timeBoundary.startDate.toISOString(),
          endDate: timeBoundary.endDate.toISOString(),
          userInstructions: editableContext?.user_instructions || '',
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start orchestration: ${response.status} ${response.statusText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.status) {
              setOrchestrationStatus(data.status);
            }
            if (typeof data.progress === 'number') {
              setOrchestrationProgress(data.progress);
            }
            
            // Update UI with intermediate data
            if (data.data) {
              if (data.data.draftWorkflowNames) {
                setDraftWorkflowNames(data.data.draftWorkflowNames);
              }
              if (data.data.workflowContext) {
                setEditableContext(data.data.workflowContext);
                setWorkflowContext(data.data.workflowContext);
              }
              if (data.data.identifiedWorkflowNames) {
                setIdentifiedWorkflowNames(data.data.identifiedWorkflowNames);
              }
              if (data.data.workflowBoundaries) {
                setWorkflowBoundaries(data.data.workflowBoundaries);
              }
              if (data.data.synthesizedWorkflows) {
                setWorkflows(data.data.synthesizedWorkflows);
              }
              if (data.data.timelineAnnotations) {
                setTimelineAnnotations(data.data.timelineAnnotations);
              }
            }

            // Check for completion or error
            if (data.success) {
              setSynthesisStep('done');
              setTimeout(() => setIsOrchestrating(false), 2000);
              break;
            }
            if (data.error) {
              throw new Error(data.details || 'Orchestration failed');
            }
          } catch (parseError) {
            console.warn('Failed to parse SSE data:', parseError);
          }
        }
      }

    } catch (error) {
      console.error('Error during full orchestration:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setOrchestrationStatus(`Error: ${errorMessage}`);
      alert(`Orchestration failed: ${errorMessage}`);
      setIsOrchestrating(false);
    } finally {
      if (orchestrationTimerRef.current) {
        clearInterval(orchestrationTimerRef.current);
        orchestrationTimerRef.current = null;
      }
    }
  };

  return {
    // Core State
    workflows,
    synthesisStep,
    isLoading,
    isAiThinking,
    isMappingTimeline,
    isFetchingEvents,
    isAnalyzingEvents,
    
    // Orchestration state and function
    isOrchestrating,
    runFullProcess,
    orchestrationStatus,
    orchestrationProgress,
    orchestrationElapsedTime,

    // Data & Context
    workflowContext,
    editableContext,
    workflowNames,
    workflowBoundaries,
    timelineAnnotations,
    userStats,

    // Core Functions
    runInitialAnalysis,
    refineAndIdentifyWorkflows,
    processAllWorkflows,
    proceedToSynthesis,
    generateAndSaveTimelineMapping,
    resetConversation,
    deleteAllWorkflows,
    saveSynthesis,
    goBackToWorkflowEditing,
    confirmBoundaries,

    // Setters & Handlers
    setWorkflows,
    setSynthesisStep,
    setWorkflowNames,
    setWorkflowBoundaries,
    handleContextChange,
    handleWorkflowsChange,
    handleTimelineAnnotationsChange,
    
    // UI State
    selectedModel,
    setSelectedModel,
    messages,
    setMessages,
    userInput,
    setUserInput,
    elapsedTime,
    analysisStatus,
    analysisProgress,
    timelineMappingStatus,
    timelineMappingProgress,
    timelineMappingElapsedTime,
    timelineMappingBatch,
    timelineMappingMode,
    setTimelineMappingMode,
    
    // Time boundary state
    timeBoundary,
    setTimeBoundary,
  };
} 