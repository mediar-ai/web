'use client';
/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useEffect, createRef, useCallback, useRef, useMemo } from 'react';
import { useUser } from '@/context/UserContext';
import type { LowLevelEvent } from '@/types';
import type {
  Message,
  CanvasContent,
  SynthesizedWorkflow,
  WorkflowStepAnalysis,
  FinalAnalysisData,
  SynthesisStep,
  WorkflowContext,
  WorkflowBoundaries,
  WorkflowDataObject,
  DatabaseWorkflow,
  SynthesisSession,
  LlmLabel,
} from './types';
import type { EnhancedTimelineEvent } from '@/lib/timelineMappingTypes';

type UserStats = {
  totalEvents: number;
  stepsProcessed: number;
  totalSteps: number;
  labelingTotal: number;
  humanLabeled: number;
};

export function useWorkflowPageLogic(userId: string) {
  const { setUserId } = useUser();
  const [view, setView] = useState<'initial' | 'chat_fullscreen' | 'canvas'>('initial');
  const [workflows, setWorkflows] = useState<CanvasContent[]>([]);
  const [activeWorkflowIndex, setActiveWorkflowIndex] = useState(0);
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
  const [draftWorkflowNames, setDraftWorkflowNames] = useState<string[]>([]);
  const [identifiedWorkflowNames, setIdentifiedWorkflowNames] = useState<string[]>([]);
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
  });
  const [editableContext, setEditableContext] = useState<WorkflowContext>({
    user_job_role: '',
    project_name: '',
    user_goal_from_recordings: '',
    overall_project_goal: '',
    overall_project_description: '',
  });
  const [isAnalyzingEvents, setIsAnalyzingEvents] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isFetchingEvents, setIsFetchingEvents] = useState(true);
  const [timelineEvents, setTimelineEvents] = useState<EnhancedTimelineEvent[]>([]);
  const [timelineMappingMode, setTimelineMappingMode] = useState(false);
  const [lowLevelEvents, setLowLevelEvents] = useState<LowLevelEvent[]>([]);
  const [llmLabels, setLlmLabels] = useState<LlmLabel[]>([]);
  const [rawAnalyses, setRawAnalyses] = useState<WorkflowStepAnalysis[]>([]);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  
  const isLoading = useMemo(() => 
    isAnalyzingEvents || 
    ['identifying', 'defining_boundaries', 'synthesizing'].includes(synthesisStep),
    [isAnalyzingEvents, synthesisStep]
  );

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

        if (session && session.session_state) {
          const { session_state } = session;
          
          const loadedMessages = Array.isArray(session_state.messages) ? session_state.messages : [];
          if (loadedMessages.length > 0) setMessages(loadedMessages);
          
          setSynthesisStep(session_state.synthesis_step || 'idle');
          setIdentifiedWorkflowNames(session_state.identified_workflow_names || []);
          setDraftWorkflowNames(session_state.draft_workflow_names || []);
          setSynthesisSessionId(session.id.toString());

          if (session_state.workflow_context) {
            setWorkflowContext(session_state.workflow_context);
            setEditableContext(session_state.workflow_context);
          }
          
          if (session_state.workflow_boundaries) {
            setWorkflowBoundaries(session_state.workflow_boundaries);
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

    const fetchUserStats = async () => {
      if (!userId) return;
      try {
        const response = await fetch(`/api/users/${userId}/stats`);
        if (response.ok) {
          const stats = await response.json();
          setUserStats(stats);
        } else {
          console.error("Failed to fetch user stats");
        }
      } catch (error) {
        console.error("Error fetching user stats:", error);
      }
    };

    const fetchEvents = async () => {
      setIsFetchingEvents(true);
      try {
        const [analysisResponse, labelsResponse] = await Promise.all([
          fetch(`/api/fetch-llm-analyses?userId=${userId}&limit=1000`),
          fetch(`/api/fetch-llm-labels?userId=${userId}`)
        ]);

        if (!analysisResponse.ok) throw new Error("Failed to fetch llm analyses");
        if (!labelsResponse.ok) throw new Error("Failed to fetch llm labels");

        const analysisData = await analysisResponse.json();
        const labelsData = await labelsResponse.json();
        
        const analyses: WorkflowStepAnalysis[] = analysisData.analyses || [];
        setRawAnalyses(analyses);
        setLlmLabels(labelsData.labels || []);

      } catch (error) {
        console.error("Error fetching events:", error);
      } finally {
        setIsFetchingEvents(false);
      }
    };

    fetchEvents();
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
    // Only update messages from a specific workflow's history if synthesis is complete
    // and the user is presumably browsing through the finalized workflows.
    if (synthesisStep === 'done' && workflows[activeWorkflowIndex]) {
      setMessages(workflows[activeWorkflowIndex].chat_history || [{ id: 'workflow-chat-default', sender: 'ai', text: "This workflow is complete. Displaying its chat history if available, or you can start a new discussion about it." }]);
    }
    // If synthesisStep is not 'done', messages are managed by the synthesis process itself 
    // (e.g., loadSynthesisSession, handleSendMessage) and should not be overwritten by the generic workflows list loading.
  }, [activeWorkflowIndex, workflows, synthesisStep]);

  const activeContent = workflows[activeWorkflowIndex];

  const fetchWorkflows = useCallback(async (skipLoadingState = false) => {
    if(!userId) return;
    try {
      const response = await fetch(`/api/workflows?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        const regularWorkflows = result.data
          .filter((d: DatabaseWorkflow) => d.title !== '__CONVERSATION__')
          .map((workflow: DatabaseWorkflow) => ({
            ...workflow,
            businessLogic: workflow.business_logic || []
          }));
        setWorkflows(regularWorkflows);
        
        if (regularWorkflows.length > 0 && synthesisStep === 'idle') {
          setView('canvas');
        }
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
        body: JSON.stringify({ analyses: rawAnalyses, labels: llmLabels, model: selectedModel }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || `API Error: ${response.status} ${response.statusText}`);
      }

      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const finalData: FinalAnalysisData = {};

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

      const defaultContext: WorkflowContext = { user_job_role: '', project_name: '', user_goal_from_recordings: '', overall_project_goal: '', overall_project_description: '' };
      setWorkflowContext(finalData.workflowContext || defaultContext);
      setEditableContext(finalData.workflowContext || defaultContext);
      setDraftWorkflowNames(finalData.workflowNames || []);
      setSynthesisStep('context_editing');

      await saveSynthesisSession(
        [], 'context_editing', [], finalData.workflowContext || defaultContext, null, finalData.workflowNames || []
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
          analyses: rawAnalyses,
          labels: llmLabels,
          workflow_context: editableContext,
          draft_workflow_names: draftWorkflowNames,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to refine workflow list');
      }

      const result = await response.json();
      setIdentifiedWorkflowNames(result.refined_workflow_names || []);
      setSynthesisStep('workflow_editing');

      await saveSynthesisSession(
        messages,
        'workflow_editing',
        result.refined_workflow_names || [],
        workflowContext,
        workflowBoundaries,
        draftWorkflowNames
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
    await saveSynthesisSession(updatedMessages, 'defining_boundaries', approvedWorkflows, workflowContext, workflowBoundaries, draftWorkflowNames);

    try {
      const response = await fetch('/api/define-workflow-boundaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          context: {
            workflows: approvedWorkflows.map(name => ({ workflow_name: name })),
            analyses: rawAnalyses,
            labels: llmLabels,
            userContext: workflowContext,
          }
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
      await saveSynthesisSession(messages.slice(0, -1).concat([boundariesMessage]), 'boundaries_editing', approvedWorkflows, workflowContext, transformedBoundaries, draftWorkflowNames);

    } catch (error) {
      console.error("Error defining workflow boundaries:", error);
      setMessages(prev => [...prev.slice(0, -1), { id: `error-${Date.now()}`, sender: 'ai', text: "Sorry, an error occurred while defining boundaries." }]);
      await saveSynthesisSession(messages, 'workflow_editing', approvedWorkflows, workflowContext, workflowBoundaries, draftWorkflowNames);
    }
  };

  const proceedToSynthesis = async (approvedBoundaries: WorkflowBoundaries) => {
    setSynthesisStep('synthesizing');
    const thinkingId = `ai-thinking-${Date.now()}`;
    const updatedMessages: Message[] = [...messages, { id: thinkingId, sender: 'ai-thinking', text: '...' }];
    setMessages(updatedMessages);
    await saveSynthesisSession(updatedMessages, 'synthesizing', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);

    try {
      // Step 1: Analyze timeline events and create workflow mappings
      const analysisResponse = await fetch('/api/analyze-timeline-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          analyses: rawAnalyses,
          labels: llmLabels,
          workflow_context: workflowContext,
          workflow_boundaries: approvedBoundaries,
          identified_workflows: identifiedWorkflowNames
        }),
      });

      if (!analysisResponse.ok) {
        throw new Error('Failed to analyze timeline events');
      }

      const analysisResult = await analysisResponse.json();
      
      // Step 2: Save the timeline event mappings to database
      const saveMappingsResponse = await fetch('/api/timeline-event-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysisResult),
      });

      if (!saveMappingsResponse.ok) {
        throw new Error('Failed to save timeline mappings');
      }

      // Step 3: Fetch the enriched timeline events for canvas display
      const fetchMappingsResponse = await fetch(`/api/timeline-event-mappings?user_id=${userId}&include_unrelated=true`);
      
      if (!fetchMappingsResponse.ok) {
        throw new Error('Failed to fetch timeline mappings');
      }

      const mappingsData = await fetchMappingsResponse.json();
      
      // Step 4: Convert timeline mappings to synthesized workflows for backwards compatibility
      const synthesizedWorkflows = convertTimelineMappingsToWorkflows(mappingsData.events, identifiedWorkflowNames);
      
      await saveSynthesizedWorkflows(synthesizedWorkflows);
      
      // Step 5: Update canvas with timeline mapping data
      await updateCanvasWithTimelineMappings(mappingsData.events);
      
      setSynthesisStep('done');
      const synthesizedMessage: Message = {
        id: `${Date.now()}`, 
        sender: 'ai', 
        text: `Successfully mapped ${mappingsData.events?.length || 0} events to ${identifiedWorkflowNames.length} workflows with detailed step-by-step traceability!`
      };
      const finalMessages = [...updatedMessages.slice(0, -1), synthesizedMessage];
      setMessages(finalMessages);
      await saveSynthesisSession(finalMessages, 'done', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);

    } catch (error) {
      console.error("Error during timeline mapping:", error);
      setMessages(prev => [...prev.slice(0, -1), { 
        id: `error-${Date.now()}`, 
        sender: 'ai', 
        text: `Sorry, I encountered an error during timeline mapping: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }]);
      setSynthesisStep('boundaries_editing');
      await saveSynthesisSession(messages, 'boundaries_editing', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);
    }
  };

  const saveSynthesizedWorkflows = async (synthesizedWorkflows: SynthesizedWorkflow[]) => {
    if (!userId || synthesizedWorkflows.length === 0) return;

    const recordsToInsert = synthesizedWorkflows.map(workflow => ({
      title: workflow.title || 'Untitled Workflow',
      inputs: workflow.inputs,
      outputs: workflow.outputs,
      steps: workflow.steps,
      business_logic: workflow.businessLogic,
      chat_history: [{id: '1', sender: 'ai', text: 'Workflow synthesized.'}],
      synthesis_session_id: synthesisSessionId,
    }));

    try {
      await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, workflows: recordsToInsert })
      });
      await fetchWorkflows(true);
    } catch (error) {
      console.error("Error saving synthesized workflows:", error);
    }
  };

  const handleSendMessage = async () => {
    // This function can be expanded later if conversational editing is needed
  };

  const handleListChange = (field: 'steps' | 'inputs' | 'outputs' | 'businessLogic', itemIndex: number, value: string) => {
    const newWorkflows = [...workflows];
    const newItems = [...newWorkflows[activeWorkflowIndex][field]];
    newItems[itemIndex] = value;
    const updatedWorkflow = { ...newWorkflows[activeWorkflowIndex], [field]: newItems };
    newWorkflows[activeWorkflowIndex] = updatedWorkflow;
    setWorkflows(newWorkflows);
    debouncedUpdateWorkflow(updatedWorkflow);
  };
  
  const handleAddItem = (field: 'steps' | 'inputs' | 'outputs' | 'businessLogic', index: number) => {
    const newWorkflows = [...workflows];
    const newItems = [...newWorkflows[activeWorkflowIndex][field]];
    newItems.splice(index + 1, 0, '');
    newWorkflows[activeWorkflowIndex] = { ...newWorkflows[activeWorkflowIndex], [field]: newItems };
    setWorkflows(newWorkflows);

    setTimeout(() => {
      const fieldKey = `${activeWorkflowIndex}-${field}`;
      itemRefs[fieldKey]?.[index + 1]?.current?.focus();
    }, 0);
  };

  const handleRemoveItem = (field: 'steps' | 'inputs' | 'outputs' | 'businessLogic', index: number) => {
    const newWorkflows = [...workflows];
    const newItems = newWorkflows[activeWorkflowIndex][field].filter((_, i) => i !== index);
    const updatedWorkflow = { ...newWorkflows[activeWorkflowIndex], [field]: newItems };
    newWorkflows[activeWorkflowIndex] = updatedWorkflow;
    setWorkflows(newWorkflows);
    debouncedUpdateWorkflow(updatedWorkflow);

    if (index > 0) {
      setTimeout(() => {
        const fieldKey = `${activeWorkflowIndex}-${field}`;
        const prevItemRef = itemRefs[fieldKey]?.[index - 1];
        if (prevItemRef?.current) {
          prevItemRef.current.focus();
          const len = prevItemRef.current.value.length;
          prevItemRef.current.setSelectionRange(len, len);
        }
      }, 0);
    }
  };
  
  const handleTitleChange = (newTitle: string) => {
    const newWorkflows = [...workflows];
    const updatedWorkflow = { ...newWorkflows[activeWorkflowIndex], title: newTitle };
    newWorkflows[activeWorkflowIndex] = updatedWorkflow;
    setWorkflows(newWorkflows);
    debouncedUpdateWorkflow(updatedWorkflow);
  };

  const debouncedUpdateWorkflow = useCallback((updatedWorkflow: CanvasContent) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      await fetch(`/api/workflows/${updatedWorkflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedWorkflow),
      });
    }, 1000);
  }, []);

  const handleDeleteWorkflow = async (workflowId: number) => {
    await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' });
    const remainingWorkflows = workflows.filter(wf => wf.id !== workflowId);
    setWorkflows(remainingWorkflows);
    setActiveWorkflowIndex(0);
    setMessages([{id: '1', sender: 'ai', text: 'Workflow deleted.'}]);
    await saveSynthesisSession([], 'idle', [], null, {});
  };

  useEffect(() => {
    if (workflowContext) {
      setEditableContext(workflowContext);
    }
  }, [workflowContext]);

  const handleContextChange = (field: keyof WorkflowContext, value: string) => {
    if (editableContext) {
      const updatedContext = { ...editableContext, [field]: value };
      setEditableContext(updatedContext);
      setWorkflowContext(updatedContext);
    }
  };

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
    setActiveWorkflowIndex(0);
    setSynthesisStep('idle');
    setIdentifiedWorkflowNames([]);
    setDraftWorkflowNames([]);
    const emptyContext: WorkflowContext = { user_job_role: '', project_name: '', user_goal_from_recordings: '', overall_project_goal: '', overall_project_description: '' };
    setWorkflowContext(emptyContext);
    setEditableContext(emptyContext);
    setWorkflowBoundaries({});

    if (synthesisSessionId) {
      try {
        await fetch(`/api/synthesis-sessions/${synthesisSessionId}`, { method: 'DELETE' });
        await saveSynthesisSession(initialMessages, 'idle', [], emptyContext, null, []);
      } catch (error) {
        console.error('Error resetting conversation:', error);
      }
    } else {
      await saveSynthesisSession(initialMessages, 'idle', [], emptyContext, null, []);
    }
    
    setSynthesisSessionId(null);
    await fetchWorkflows(true);
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
      setActiveWorkflowIndex(0);
      setSynthesisStep('idle');
      setIdentifiedWorkflowNames([]);
      setDraftWorkflowNames([]);
      const emptyContext: WorkflowContext = { user_job_role: '', project_name: '', user_goal_from_recordings: '', overall_project_goal: '', overall_project_description: '' };
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

  const goBackToWorkflowEditing = () => {
    setSynthesisStep('workflow_editing');
  };

  const confirmBoundaries = () => {
    proceedToSynthesis(workflowBoundaries);
  };

  const convertTimelineMappingsToWorkflows = (events: EnhancedTimelineEvent[], workflowNames: string[]): SynthesizedWorkflow[] => {
    const workflowMap = new Map<string, {
      inputs: Set<string>,
      outputs: Set<string>, 
      steps: Set<string>,
      businessLogic: Set<string>
    }>();

    // Initialize workflow map
    workflowNames.forEach(name => {
      workflowMap.set(name, {
        inputs: new Set(),
        outputs: new Set(),
        steps: new Set(), 
        businessLogic: new Set()
      });
    });

    // Process each event's workflow mappings
    events?.forEach(event => {
      if (event.workflow_mappings) {
        event.workflow_mappings.forEach(mapping => {
          const workflowTypeName = mapping.workflow_type.type_name;
          const workflowData = workflowMap.get(workflowTypeName);
          if (workflowData) {
            // Add inputs, outputs, steps, business logic
            mapping.event_inputs?.forEach((input: string) => workflowData.inputs.add(input));
            mapping.event_outputs?.forEach((output: string) => workflowData.outputs.add(output));
            
            const stepText = mapping.workflow_substep ? 
              `${mapping.workflow_step} → ${mapping.workflow_substep}` : 
              mapping.workflow_step;
            workflowData.steps.add(stepText);
            
            mapping.business_logics?.forEach((logic: string) => workflowData.businessLogic.add(logic));
          }
        });
      }
    });

    // Convert map to SynthesizedWorkflow array
    return Array.from(workflowMap.entries()).map(([title, data]) => ({
      title,
      inputs: Array.from(data.inputs),
      outputs: Array.from(data.outputs),
      steps: Array.from(data.steps),
      businessLogic: Array.from(data.businessLogic)
    }));
  };

  const updateCanvasWithTimelineMappings = async (events: EnhancedTimelineEvent[]) => {
    setTimelineEvents(events);
    setTimelineMappingMode(true);
    
    // Convert timeline events to canvas content for display
    const canvasWorkflows: CanvasContent[] = events
      ?.filter(event => event.is_workflow_related)
      .reduce((acc: CanvasContent[], event) => {
        event.workflow_mappings?.forEach(mapping => {
          const workflowTypeName = mapping.workflow_type.type_name;
          const existing = acc.find(item => item.title === workflowTypeName);
          if (existing) {
            // Add event details to existing workflow
            if (mapping.event_inputs) existing.inputs.push(...mapping.event_inputs);
            if (mapping.event_outputs) existing.outputs.push(...mapping.event_outputs);
            if (mapping.business_logics) existing.businessLogic.push(...mapping.business_logics);
            
            const stepText = `[${event.timestamp}] ${mapping.workflow_step}${mapping.workflow_substep ? ` → ${mapping.workflow_substep}` : ''}`;
            existing.steps.push(stepText);
          } else {
            // Create new workflow entry
            acc.push({
              id: Date.now() + Math.random(), // Generate unique ID for canvas
              title: workflowTypeName,
              inputs: mapping.event_inputs || [],
              outputs: mapping.event_outputs || [],
              steps: [`[${event.timestamp}] ${mapping.workflow_step}${mapping.workflow_substep ? ` → ${mapping.workflow_substep}` : ''}`],
              businessLogic: mapping.business_logics || [],
              chat_history: [{ id: 'timeline-mapping', sender: 'ai', text: 'Generated from timeline mapping analysis' }]
            });
          }
        });
        return acc;
      }, []) || [];

    setWorkflows(canvasWorkflows);
  };

  return {
    view, setView, workflows, setWorkflows, activeWorkflowIndex, setActiveWorkflowIndex,
    messages, setMessages, userInput, setUserInput, selectedModel, setSelectedModel,
    identifiedWorkflowNames, workflowContext, collapsedSections, toggleSection,
    isAnalyzingEvents, isLoading, synthesisStep, setSynthesisStep,
    rawAnalyses, workflowBoundaries,
    processAllWorkflows, proceedToSynthesis, handleSendMessage, handleListChange,
    draftWorkflowNames, setDraftWorkflowNames, confirmBoundaries,
    elapsedTime, isFetchingEvents, 
    // Canvas editing state and functions
    activeContent, itemRefs,
    handleAddItem, handleRemoveItem, handleTitleChange, handleDeleteWorkflow,
    handleContextChange, resetConversation, deleteAllWorkflows,
    runInitialAnalysis, refineAndIdentifyWorkflows,
    isAiThinking, editableContext, analysisStatus, analysisProgress,
    setIdentifiedWorkflowNames, setWorkflowBoundaries, goBackToWorkflowEditing,
    // New timeline mapping state
    timelineEvents, timelineMappingMode, setTimelineMappingMode,
    llmLabels,
    userStats,
    // Timeline view mode functions
    convertTimelineMappingsToWorkflows, updateCanvasWithTimelineMappings
  };
} 