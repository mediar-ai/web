'use client';
/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useEffect, createRef, useCallback, useRef } from 'react';
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
  const [isLoading, setIsLoading] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [itemRefs, setItemRefs] = useState<Record<string, React.RefObject<HTMLTextAreaElement | null>[]>>({});
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [synthesisStep, setSynthesisStep] = useState<SynthesisStep>('idle');
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
    project_goal: ''
  });
  const [editableContext, setEditableContext] = useState<WorkflowContext>({
    user_job_role: '',
    project_name: '',
    project_goal: ''
  });
  const [isAnalyzingEvents, setIsAnalyzingEvents] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [isFetchingEvents, setIsFetchingEvents] = useState(true);
  
  // Refs for chat scroll containers
  const fullscreenChatRef = useRef<HTMLDivElement>(null);
  const sidebarChatRef = useRef<HTMLDivElement>(null);

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Scroll chat to bottom
  const scrollToBottom = useCallback(() => {
    // Scroll fullscreen chat
    if (fullscreenChatRef.current) {
      fullscreenChatRef.current.scrollTop = fullscreenChatRef.current.scrollHeight;
    }
    // Scroll sidebar chat
    if (sidebarChatRef.current) {
      sidebarChatRef.current.scrollTop = sidebarChatRef.current.scrollHeight;
    }
  }, []);

  // Auto-scroll when messages change
  useEffect(() => {
    // Use setTimeout to ensure DOM has updated
    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages, scrollToBottom]);

  const saveSynthesisSession = useCallback(async (
    messagesToSave: Message[], 
    step: SynthesisStep, 
    workflowNames: string[], 
    context: WorkflowContext | null,
    boundaries: WorkflowBoundaries | null
  ) => {
    if (!userId) return;

    const sessionState = {
      messages: messagesToSave,
      synthesis_step: step,
      identified_workflow_names: workflowNames,
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
        if (!synthesisSessionId) {
          if (result.data) {
            setSynthesisSessionId(result.data.id);
          }
        }
      } else {
        const errorText = await response.text();
        if (response.status === 404 && synthesisSessionId) {
          // Session was deleted, clear the ID so next save will create a new one
          console.log(`Synthesis session ${synthesisSessionId} was deleted, creating new session on next save`);
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
      console.log('[WORKFLOW_DEBUG] Loading synthesis session for userId:', userId);
      const response = await fetch(`/api/synthesis-sessions?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        console.log('[WORKFLOW_DEBUG] Synthesis session response:', result);
        const session: SynthesisSession = result.data;

        if (session && session.session_state) {
          const { session_state } = session;
          console.log('[WORKFLOW_DEBUG] Found session state:', session_state);
          
          const loadedMessages = Array.isArray(session_state.messages) ? session_state.messages : [];
          
          if (loadedMessages.length > 0) {
            setMessages(loadedMessages);
          }
          setSynthesisStep(session_state.synthesis_step || 'idle');
          setIdentifiedWorkflowNames(session_state.identified_workflow_names || []);
          setSynthesisSessionId(session.id.toString());

          if (session_state.workflow_context) {
            setWorkflowContext(session_state.workflow_context);
            setEditableContext(session_state.workflow_context);
          }
          
          if (session_state.workflow_boundaries) {
            setWorkflowBoundaries(session_state.workflow_boundaries);
          }
          
          console.log('[WORKFLOW_DEBUG] Synthesis step loaded:', session_state.synthesis_step);
        } else {
          console.log('[WORKFLOW_DEBUG] No session data found');
        }
      } else {
        console.log('[WORKFLOW_DEBUG] No synthesis session found or error:', response.status);
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
        // Fetch workflow analyses
        const analysisResponse = await fetch(`/api/fetch-llm-analyses?userId=${userId}&limit=1000`);
        if (!analysisResponse.ok) throw new Error("Failed to fetch llm analyses");
        const analysisData = await analysisResponse.json();
        const analyses: WorkflowStepAnalysis[] = analysisData.analyses || [];

        // Fetch user annotation data (like labeling tab does)
        const eventDataResponse = await fetch(`/api/get-dataset-entries?userId=${userId}&datasetType=workflow_event_feedback`);
        const eventDataMap: Record<string, { generated_output: string; feedback: 'good' | 'bad' | 'irrelevant' | null; feedback_reason: string | null }> = {};
        
        if (eventDataResponse.ok) {
          const eventData = await eventDataResponse.json();
          eventData.entries.forEach((entry: { low_level_workflow_analysis_id: string; generated_output: string; feedback: 'good' | 'bad' | 'irrelevant' | null; feedback_reason: string | null }) => {
            const analysisId = String(entry.low_level_workflow_analysis_id);
            eventDataMap[analysisId] = {
              generated_output: entry.generated_output,
              feedback: entry.feedback,
              feedback_reason: entry.feedback_reason
            };
          });
        }

        // Fetch low-level events for context (like labeling tab does)
        const eventsResponse = await fetch(`/api/low-level/${userId}`);
        let allEvents: LowLevelEvent[] = [];
        if (eventsResponse.ok) {
          const eventsData = await eventsResponse.json();
          allEvents = eventsData.events?.sort((a: LowLevelEvent, b: LowLevelEvent) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) || [];
        }

        const uiTreeEvents = allEvents.filter(e => e.payload.payload?.type === 'ui_tree');

        const getEventTitle = (event: LowLevelEvent) => {
          const payload = event.payload as { payload?: { event?: { app_name?: string, screen?: { ui_tree?: string } } } };
          const appName = payload?.payload?.event?.app_name || 'Unknown App';
          const uiTree = payload?.payload?.event?.screen?.ui_tree;
          if (uiTree) {
            try {
              const parsedTree = JSON.parse(uiTree);
              return parsedTree.attributes?.name || appName;
            } catch {
              return appName;
            }
          }
          return appName;
        };

        // Create enhanced combined events (like labeling tab does)
        const combined: CombinedEvent[] = analyses.reduce<CombinedEvent[]>((acc, analysis) => {
          const eventTime = new Date(analysis.client_timestamp).getTime();
          const currentUiTreeEvent = uiTreeEvents.find(e => Math.abs(new Date(e.created_at).getTime() - eventTime) < 1000);
          
          let contextSummary = { windowTitle: 'Unknown', eventCount: 0 };
          
          if (currentUiTreeEvent) {
            const currentIndex = uiTreeEvents.findIndex(e => e.id === currentUiTreeEvent.id);
            const previousUiTreeEvent = currentIndex > 0 ? uiTreeEvents[currentIndex - 1] : null;

            const eventsBetween = previousUiTreeEvent ? allEvents.filter(event => {
              const eventTimestamp = new Date(event.created_at).getTime();
              const prevTimestamp = new Date(previousUiTreeEvent!.created_at).getTime();
              const isRelevant = event.payload.payload?.type !== 'ui_tree' && event.payload.payload?.type !== 'screenshot_diff';
              return isRelevant && eventTimestamp > prevTimestamp && eventTimestamp < eventTime;
            }) : [];

            contextSummary = {
              windowTitle: getEventTitle(currentUiTreeEvent),
              eventCount: eventsBetween.length
            };
          }

          const userAnnotation = eventDataMap[analysis.id];
          
          // Only include events that are not marked as 'bad' or 'irrelevant'
          // This filters for quality like we discussed
          if (userAnnotation && (userAnnotation.feedback === 'bad' || userAnnotation.feedback === 'irrelevant')) {
            return acc;
          }

          acc.push({
            analysis,
            generated_output: userAnnotation?.generated_output || null,
            feedback: userAnnotation?.feedback || null,
            contextSummary,
            timestamp: new Date(analysis.client_timestamp)
          });
          
          return acc;
        }, []);

        // Sort by timestamp descending (like labeling tab does)
        combined.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        setCombinedEvents(combined);
      } catch (error) {
        console.error("Error fetching events:", error);
      } finally {
        setIsFetchingEvents(false);
      }
    };

    fetchEvents();
  }, [userId, setUserId, loadSynthesisSession]);

  useEffect(() => {
    // Create refs for all editable items
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
    if(workflows[activeWorkflowIndex]) {
      setMessages(workflows[activeWorkflowIndex].chat_history || [{ id: '1', sender: 'ai', text: "I've identified this workflow. How can I help you refine it?" }]);
    }
  }, [activeWorkflowIndex, workflows]);

  const activeContent = workflows[activeWorkflowIndex];

  const fetchWorkflows = useCallback(async () => {
    if(!userId) return;
    setIsLoading(true);
    try {
      console.log('[WORKFLOW_DEBUG] Fetching workflows for userId:', userId);
      const response = await fetch(`/api/workflows?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        console.log('[WORKFLOW_DEBUG] API response:', result);
        const regularWorkflows = result.data
          .filter((d: DatabaseWorkflow) => d.title !== '__CONVERSATION__')
          .map((workflow: DatabaseWorkflow) => ({
            ...workflow,
            businessLogic: workflow.business_logic || []
          }));
        console.log('[WORKFLOW_DEBUG] Filtered workflows:', regularWorkflows);
        setWorkflows(regularWorkflows);
        
        // Auto-switch to canvas view if workflows exist
        if (regularWorkflows.length > 0) {
          console.log('[WORKFLOW_DEBUG] Switching to canvas view - found', regularWorkflows.length, 'workflows');
          setView('canvas');
        } else {
          console.log('[WORKFLOW_DEBUG] No workflows found, staying in initial view');
        }
      } else {
        console.error('[WORKFLOW_DEBUG] API response not ok:', response.status, response.statusText);
      }
    } catch (error) {
      console.error('[WORKFLOW_DEBUG] Failed to fetch workflows:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);
  
  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const startWorkflowIdentification = async () => {
    setIsAnalyzingEvents(true);
    setAnalysisStatus("Starting analysis...");
    setAnalysisProgress(0);
    setElapsedTime(0);
    setIsAiThinking(true);

    // Start timer
    timerRef.current = setInterval(() => {
      setElapsedTime(prevTime => prevTime + 0.1);
    }, 100);

    setMessages([{
      id: 'analyzing',
      sender: 'ai-thinking',
      text: 'Analyzing events...'
    }]);

    try {
      const response = await fetch('/api/initiate-workflow-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: combinedEvents, model: selectedModel }),
      });

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const finalData: FinalAnalysisData = {};

      const processChunk = (chunk: string) => {
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'));
        for (const line of lines) {
          const jsonString = line.substring(5);
          try {
            const parsed = JSON.parse(jsonString);
            if (parsed.status) {
              setAnalysisStatus(parsed.status);
            }
            if (typeof parsed.progress === 'number') {
              setAnalysisProgress(parsed.progress);
            }
            if (parsed.data) {
              if (parsed.data.workflowNames) {
                finalData.workflowNames = parsed.data.workflowNames;
              }
              if (parsed.data.workflowContext) {
                finalData.workflowContext = parsed.data.workflowContext;
              }
            }
          } catch {
          }
        }
      };
      
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // Keep the last, possibly incomplete, part
        parts.forEach(processChunk);
      }
      processChunk(buffer); // Process any remaining data

      const newMessages: Message[] = [
        { 
          id: 'context-summary', 
          sender: 'ai', 
          text: `Based on my analysis, here's what I understand about the user's context.`
        },
        { 
          id: 'workflow-list', 
          sender: 'ai', 
          text: `I have identified the following potential workflows. You can edit the names below and then approve to generate the full workflow definitions.`
        }
      ];

      setMessages(newMessages);
      setIdentifiedWorkflowNames(finalData.workflowNames || []);
      const defaultContext = { user_job_role: '', project_name: '', project_goal: '' };
      setWorkflowContext(finalData.workflowContext || defaultContext);
      setEditableContext(finalData.workflowContext || defaultContext);
      setSynthesisStep('identifying');

      await saveSynthesisSession(
        newMessages, 
        'identifying',
        finalData.workflowNames || [],
        finalData.workflowContext || defaultContext,
        null
      );

    } catch (error) {
      console.error("Error during workflow identification:", error);
      const errorId = `error-${Date.now()}`;
      const errorMessage: Message = { id: errorId, sender: 'ai', text: "Sorry, I encountered an error. Please try again." };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
      await saveSynthesisSession(messages, 'idle', [], workflowContext, workflowBoundaries);
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setIsAnalyzingEvents(false);
      setIsAiThinking(false);
    }
  };

  const processAllWorkflows = async (approvedWorkflows: string[]) => {
    setSynthesisStep('defining_boundaries');
    const thinkingId = `ai-thinking-${Date.now()}`;
    const updatedMessages: Message[] = [...messages, { id: thinkingId, sender: 'ai-thinking', text: '...' }];
    setMessages(updatedMessages);
    await saveSynthesisSession(updatedMessages, 'defining_boundaries', approvedWorkflows, workflowContext, workflowBoundaries);

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
      
      // Set boundaries in state and show boundary editing step
      setWorkflowBoundaries(boundaries);
      setSynthesisStep('boundaries_editing');
      
      const boundariesMessage: Message = { 
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
        sender: 'ai', 
        text: "I've defined boundaries for your workflows. Please review and approve them above, or make any changes before proceeding to synthesis."
      };
      setMessages(prev => [...prev.slice(0, -1), boundariesMessage]);
      
      await saveSynthesisSession(messages.slice(0, -1).concat([boundariesMessage]), 'boundaries_editing', approvedWorkflows, workflowContext, boundaries);

    } catch (error) {
      console.error("Error defining workflow boundaries:", error);
      const errorId = `error-${Date.now()}`;
      const errorMessage: Message = { id: errorId, sender: 'ai', text: "Sorry, an error occurred while defining boundaries. Please try again." };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
      await saveSynthesisSession(messages.slice(0,-1), 'workflow_editing', approvedWorkflows, workflowContext, workflowBoundaries);
    }
  };

  const proceedToSynthesis = async (approvedBoundaries: WorkflowBoundaries) => {
    setSynthesisStep('synthesizing');
    const thinkingId = `ai-thinking-${Date.now()}`;
    const updatedMessages: Message[] = [...messages, { id: thinkingId, sender: 'ai-thinking', text: '...' }];
    setMessages(updatedMessages);
    await saveSynthesisSession(updatedMessages, 'synthesizing', identifiedWorkflowNames, workflowContext, approvedBoundaries);

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
              events: combinedEvents // Pass ALL events - AI will determine relevance
            }))
          }
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const synthesizedWorkflows = result.workflows || [];
        
        await saveSynthesizedWorkflows(synthesizedWorkflows);

        // Final state update
        setView('canvas');
        setSynthesisStep('done');
        const synthesizedMessage: Message = {id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', text: "Workflows have been synthesized. You can now view and refine them in the Canvas tab."};
        await saveSynthesisSession(updatedMessages.slice(0,-1).concat([synthesizedMessage]), 'done', identifiedWorkflowNames, workflowContext, approvedBoundaries);

      } else {
        throw new Error('Failed to synthesize workflows');
      }
    } catch (error) {
      console.error("Error during workflow synthesis:", error);
      const errorId = `error-${Date.now()}`;
      const errorMessage: Message = { id: errorId, sender: 'ai', text: "Sorry, I encountered an error during synthesis. Please try again." };
      setMessages(prev => [...prev.slice(0, -1), errorMessage]);
      await saveSynthesisSession(messages, 'boundaries_editing', identifiedWorkflowNames, workflowContext, approvedBoundaries);
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
        body: JSON.stringify({
          userId: userId,
          workflows: recordsToInsert
        })
      });
      
      // After saving, refresh the workflows from the database
      await fetchWorkflows();
    } catch (error) {
      console.error("Error saving synthesized workflows:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;
    const userMessage: Message = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, sender: 'user', text: userInput };
    setMessages(prev => [...prev, userMessage]);
    const instruction = userInput;
    setUserInput('');
    setIsAiThinking(true);

    try {
      if (synthesisStep === 'workflow_editing') {
        // Handle natural language workflow list editing
        const response = await fetch('/api/edit-workflow-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedModel,
            instruction,
            current_workflows: identifiedWorkflowNames
          }),
        });
        
        if (response.ok) {
        const result = await response.json();
          setIdentifiedWorkflowNames(result.workflows || []);
          setMessages(prev => [...prev, { 
            id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
            sender: 'ai', 
            text: "I've updated the workflow list based on your instruction. Please review the changes above."
          }]);
        } else {
          throw new Error('Failed to update workflow list');
        }
      } else {
        // Future: Handle other conversational edits when in canvas mode
        setMessages(prev => [...prev, { 
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
          sender: 'ai', 
          text: "I understand you want to make changes, but I can only help during the workflow identification phase right now. Please use the direct editing interface in the canvas."
        }]);
      }
    } catch {
      const aiErrorResponse: Message = { id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, sender: 'ai', text: "Sorry, something went wrong. Please try again." };
      setMessages(prev => [...prev, aiErrorResponse]);
    }
    setIsAiThinking(false);
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
    newItems.splice(index + 1, 0, ''); // Insert new empty item
    newWorkflows[activeWorkflowIndex] = { ...newWorkflows[activeWorkflowIndex], [field]: newItems };
    setWorkflows(newWorkflows);

    // Focus the new item
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

    // Focus the previous item and move cursor to the end
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
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(async () => {
      await fetch(`/api/workflows/${updatedWorkflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedWorkflow),
      });
    }, 1000); // 1 second debounce
  }, []);

  const handleDeleteWorkflow = async (workflowId: number) => {
    await fetch(`/api/workflows/${workflowId}`, { method: 'DELETE' });
    const remainingWorkflows = workflows.filter(wf => wf.id !== workflowId);
    setWorkflows(remainingWorkflows);
    setActiveWorkflowIndex(0);
    
    // This is tricky - what conversation to load now?
    // For now, let's just clear messages, but ideally we'd have a 'main' conversation context
    const newMessage: Message = {id: '1', sender: 'ai', text: 'Workflow deleted. Select another workflow or go to Capture tab.'};
    setMessages([newMessage]);
    await saveSynthesisSession([], 'idle', [], null, {});
  };

  // When workflowContext is loaded or changed, update the editable version
  useEffect(() => {
    if (workflowContext) {
      setEditableContext(workflowContext);
    }
  }, [workflowContext]);

  const handleContextChange = (field: keyof WorkflowContext, value: string) => {
    if (editableContext) {
      const updatedContext = { ...editableContext, [field]: value };
      setEditableContext(updatedContext);
      // Auto-save immediately when field changes
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
    
    // Immediately clear local state for a snappy UI response
    setMessages(initialMessages);
    setWorkflows([]);
    setActiveWorkflowIndex(0);
    setSynthesisStep('idle');
    setIdentifiedWorkflowNames([]);
    const emptyContext = { user_job_role: '', project_name: '', project_goal: '' };
    setWorkflowContext(emptyContext);
    setEditableContext(emptyContext);
    setWorkflowBoundaries({});

    if (synthesisSessionId) {
      try {
        // Delete the main synthesis session entry
        await fetch(`/api/synthesis-sessions/${synthesisSessionId}`, { method: 'DELETE' });
        
        // Create a new initial synthesis session
        await saveSynthesisSession(initialMessages, 'idle', [], emptyContext, null);

      } catch {
      }
    } else {
      // If there was no conversationId, we might still need to ensure the initial state is saved
      await saveSynthesisSession(initialMessages, 'idle', [], emptyContext, null);
    }
    
    // This resets the conversationId to null after deletion and before a new one is created
    setSynthesisSessionId(null);
    
    // Refetch workflows to clear out any old ones that were on the canvas
    const res = await fetch(`/api/workflows?userId=${userId}`);
    if(res.ok){
      const data = await res.json();
      const workflowsToDisplay = data.data.filter((wf: WorkflowDataObject) => wf.title !== '__CONVERSATION__');
      setWorkflows(workflowsToDisplay);
      if(workflowsToDisplay.length > 0){
        setView('canvas');
        setActiveWorkflowIndex(0);
      } else {
        setView('initial');
      }
    }

    setIsAiThinking(false);
  };

  const deleteAllWorkflows = async () => {
    setIsAiThinking(true);
    
    try {
      // Clear any pending auto-save timeout to prevent it from saving old state
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      
      // Delete ALL workflows for this user
      const response = await fetch(`/api/workflows/delete-all?userId=${userId}`, { 
        method: 'DELETE' 
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete workflows: ${response.statusText}`);
      }
      
      console.log('All workflows deleted successfully');
      
      // Also delete the synthesis session if it exists
      if (synthesisSessionId) {
        try {
          await fetch(`/api/synthesis-sessions/${synthesisSessionId}`, { method: 'DELETE' });
          console.log('Synthesis session deleted successfully');
        } catch (sessionError) {
          console.error('Error deleting synthesis session:', sessionError);
          // Don't fail the whole operation if session deletion fails
        }
      }
      
      // Reset to completely clean state
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
      const emptyContext = { user_job_role: '', project_name: '', project_goal: '' };
      setWorkflowContext(emptyContext);
      setEditableContext(emptyContext);
      setWorkflowBoundaries({});
      setSynthesisSessionId(null);
      setView('initial');
      
    } catch (error) {
      console.error('Error deleting all workflows:', error);
      
      // Clear any pending auto-save timeout here too
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      
      // Still reset local state even if API call failed
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
      const emptyContext = { user_job_role: '', project_name: '', project_goal: '' };
      setWorkflowContext(emptyContext);
      setEditableContext(emptyContext);
      setWorkflowBoundaries({});
      setSynthesisSessionId(null);
      setView('initial');
    } finally {
      setIsAiThinking(false);
    }
  };

  // Auto-scroll logic for both chat views
  useEffect(() => {
    if (view === 'chat_fullscreen') {
      scrollToBottom();
    } else {
      scrollToBottom();
    }
  }, [messages, view]);

  // Debug: Track view and workflow state changes
  useEffect(() => {
    console.log('[WORKFLOW_DEBUG] State update:', {
      view,
      workflowCount: workflows.length,
      synthesisStep,
      isLoading,
      workflowTitles: workflows.map(w => w.title)
    });
  }, [view, workflows, synthesisStep, isLoading]);

  return {
    // State
    view,
    setView,
    workflows,
    setWorkflows,
    activeWorkflowIndex,
    setActiveWorkflowIndex,
    messages,
    setMessages,
    userInput,
    setUserInput,
    selectedModel,
    setSelectedModel,
    isLoading,
    setIsLoading,
    isAiThinking,
    setIsAiThinking,
    itemRefs,
    setItemRefs,
    saveTimeoutRef,
    synthesisStep,
    setSynthesisStep,
    identifiedWorkflowNames,
    setIdentifiedWorkflowNames,
    workflowBoundaries,
    setWorkflowBoundaries,
    combinedEvents,
    setCombinedEvents,
    collapsedSections,
    setCollapsedSections,
    synthesisSessionId,
    setSynthesisSessionId,
    workflowContext,
    setWorkflowContext,
    editableContext,
    setEditableContext,
    isAnalyzingEvents,
    setIsAnalyzingEvents,
    analysisStatus,
    setAnalysisStatus,
    analysisProgress,
    setAnalysisProgress,
    elapsedTime,
    setElapsedTime,
    timerRef,
    isFetchingEvents,
    setIsFetchingEvents,
    fullscreenChatRef,
    sidebarChatRef,

    // Handlers
    toggleSection,
    scrollToBottom,
    startWorkflowIdentification,
    processAllWorkflows,
    proceedToSynthesis,
    saveSynthesizedWorkflows,
    handleSendMessage,
    handleListChange,
    handleAddItem,
    handleRemoveItem,
    handleTitleChange,
    debouncedUpdateWorkflow,
    handleDeleteWorkflow,
    handleContextChange,
    resetConversation,
    deleteAllWorkflows,

    // Derived
    activeContent,
  } as const;
} 