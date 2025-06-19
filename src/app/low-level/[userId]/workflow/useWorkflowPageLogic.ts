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
  CombinedEvent,
  FinalAnalysisData,
  SynthesisStep,
  WorkflowContext,
  WorkflowBoundaries,
  WorkflowDataObject,
  DatabaseWorkflow,
  SynthesisSession,
} from './types';

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
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro-preview-06-05');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [itemRefs, setItemRefs] = useState<Record<string, React.RefObject<HTMLTextAreaElement | null>[]>>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [synthesisStep, setSynthesisStep] = useState<SynthesisStep>('idle');
  const [draftWorkflowNames, setDraftWorkflowNames] = useState<string[]>([]);
  const [identifiedWorkflowNames, setIdentifiedWorkflowNames] = useState<string[]>([]);
  const [workflowBoundaries, setWorkflowBoundaries] = useState<WorkflowBoundaries>({});
  const [combinedEvents, setCombinedEvents] = useState<CombinedEvent[]>([]);
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
      }
    } catch (error) {
      console.error('[WORKFLOW_DEBUG] Error loading synthesis session:', error);
    }
  }, [userId]);

  useEffect(() => {
    setUserId(userId);
    loadSynthesisSession();

    const fetchEvents = async () => {
      setIsFetchingEvents(true);
      try {
        const analysisResponse = await fetch(`/api/fetch-llm-analyses?userId=${userId}&limit=1000`);
        if (!analysisResponse.ok) throw new Error("Failed to fetch llm analyses");
        const analysisData = await analysisResponse.json();
        const analyses: WorkflowStepAnalysis[] = analysisData.analyses || [];

        const eventsResponse = await fetch(`/api/low-level/${userId}`);
        let allEvents: LowLevelEvent[] = [];
        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json();
          allEvents = eventsData.events?.sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || [];
        }
        
        const combined = allEvents.map(event => ({ event }));
        // This is a simplified combination. The previous logic was more complex and might be restored if needed.
        setCombinedEvents(analyses.map(analysis => ({ analysis, generated_output: null, feedback: null, contextSummary: { windowTitle: '', eventCount: 0}, timestamp: new Date(analysis.client_timestamp)})));

      } catch (error) {
        console.error("Error fetching events:", error);
      } finally {
        setIsFetchingEvents(false);
      }
    };

    fetchEvents();
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
        body: JSON.stringify({ events: combinedEvents, model: selectedModel }),
      });

      if (!response.body) throw new Error("Response body is null");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const finalData: FinalAnalysisData = {};

      const processChunk = (chunk: string) => {
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line.substring(5));
            if (parsed.status) setAnalysisStatus(parsed.status);
            if (typeof parsed.progress === 'number') setAnalysisProgress(parsed.progress);
            if (parsed.data?.workflowNames) finalData.workflowNames = parsed.data.workflowNames;
            if (parsed.data?.workflowContext) finalData.workflowContext = parsed.data.workflowContext;
          } catch {}
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
      setMessages([{ id: `error-${Date.now()}`, sender: 'ai', text: "Sorry, I encountered an error. Please try again." }]);
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
          events: combinedEvents,
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
            events: combinedEvents,
            userContext: workflowContext,
          }
        })
      });

      if (!response.ok) throw new Error('Failed to define workflow boundaries');
      
      const boundaries = await response.json();
      setWorkflowBoundaries(boundaries);
      setSynthesisStep('boundaries_editing');
      
      const boundariesMessage: Message = { 
        id: `${Date.now()}`, sender: 'ai', text: "I've defined boundaries for your workflows. Please review and approve them above."
      };
      setMessages(prev => [...prev.slice(0, -1), boundariesMessage]);
      await saveSynthesisSession(messages.slice(0, -1).concat([boundariesMessage]), 'boundaries_editing', approvedWorkflows, workflowContext, boundaries, draftWorkflowNames);

    } catch (error) {
      console.error("Error defining workflow boundaries:", error);
      setMessages(prev => [...prev.slice(0, -1), { id: `error-${Date.now()}`, sender: 'ai', text: "Sorry, an error occurred while defining boundaries." }]);
      await saveSynthesisSession(messages.slice(0,-1), 'workflow_editing', approvedWorkflows, workflowContext, workflowBoundaries, draftWorkflowNames);
    }
  };

  const proceedToSynthesis = async (approvedBoundaries: WorkflowBoundaries) => {
    setSynthesisStep('synthesizing');
    const thinkingId = `ai-thinking-${Date.now()}`;
    const updatedMessages: Message[] = [...messages, { id: thinkingId, sender: 'ai-thinking', text: '...' }];
    setMessages(updatedMessages);
    await saveSynthesisSession(updatedMessages, 'synthesizing', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);

    try {
      const response = await fetch('/api/synthesize-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          context: { 
            workflows: identifiedWorkflowNames.map(name => ({
              name,
              trigger: approvedBoundaries[name]?.trigger,
              terminator: approvedBoundaries[name]?.terminator,
              events: combinedEvents
            })),
            workflowContext: workflowContext,
          }
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const synthesizedWorkflows = result.workflows || [];
        
        await saveSynthesizedWorkflows(synthesizedWorkflows);
        setSynthesisStep('done');
        const synthesizedMessage: Message = {id: `${Date.now()}`, sender: 'ai', text: "Workflows have been synthesized successfully!"};
        const finalMessages = [...updatedMessages.slice(0, -1), synthesizedMessage];
        setMessages(finalMessages);
        await saveSynthesisSession(finalMessages, 'done', identifiedWorkflowNames, workflowContext, approvedBoundaries, draftWorkflowNames);

      } else {
        throw new Error('Failed to synthesize workflows');
      }
    } catch (error) {
      console.error("Error during workflow synthesis:", error);
      setMessages(prev => [...prev.slice(0, -1), { id: `error-${Date.now()}`, sender: 'ai', text: "Sorry, I encountered an error during synthesis." }]);
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

  return {
    view, setView, workflows, setWorkflows, activeWorkflowIndex, setActiveWorkflowIndex,
    messages, setMessages, userInput, setUserInput, selectedModel, setSelectedModel,
    isLoading, isAiThinking, setIsAiThinking, itemRefs, setItemRefs,
    saveTimeoutRef, synthesisStep, setSynthesisStep, identifiedWorkflowNames, setIdentifiedWorkflowNames,
    workflowBoundaries, setWorkflowBoundaries, combinedEvents, setCombinedEvents,
    collapsedSections, setCollapsedSections, synthesisSessionId, setSynthesisSessionId,
    workflowContext, setWorkflowContext, editableContext, setEditableContext,
    isAnalyzingEvents, setIsAnalyzingEvents, analysisStatus, setAnalysisStatus,
    analysisProgress, setAnalysisProgress, elapsedTime, setElapsedTime, timerRef,
    isFetchingEvents, setIsFetchingEvents, fullscreenChatRef, sidebarChatRef,
    toggleSection, scrollToBottom, runInitialAnalysis, refineAndIdentifyWorkflows,
    processAllWorkflows, proceedToSynthesis, handleSendMessage, handleListChange,
    handleAddItem, handleRemoveItem, handleTitleChange, handleDeleteWorkflow,
    handleContextChange, resetConversation, deleteAllWorkflows, activeContent,
  } as const;
} 