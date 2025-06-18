'use client';

import { useState, useEffect, use, createRef, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Send, PlusCircle, Trash2, RefreshCw, X, ChevronRight, ChevronDown, Edit3, RotateCcw } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUser } from '@/context/UserContext';
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"

type Message = {
    id: string;
    sender: 'user' | 'ai' | 'ai-thinking';
    text: string;
}

type CanvasContent = {
    id: number;
    title: string;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
    chat_history: Message[];
}

type WorkflowStepAnalysis = {
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

type CombinedEvent = {
    analysis: WorkflowStepAnalysis;
    generated_output: string | null;
}

type FetchedEventEntry = {
    low_level_workflow_analysis_id: string;
    generated_output: string;
}

type SynthesisStep = 'idle' | 'identifying' | 'workflow_editing' | 'defining_boundaries' | 'synthesizing' | 'done';

const EditableListItem = ({ item, onChange, onRemove, onEnter, onBackspaceEmpty, itemRef }: { 
    item: string, 
    onChange: (value: string) => void, 
    onRemove: () => void,
    onEnter: () => void,
    onBackspaceEmpty: () => void,
    itemRef: React.RefObject<HTMLTextAreaElement | null>
}) => {
    
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
        } else if (e.key === 'Backspace' && item === '') {
            e.preventDefault();
            onBackspaceEmpty();
        }
    };

    return (
        <div className="flex items-start group">
            <Textarea 
                ref={itemRef}
                value={item} 
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full border-0 p-0 h-auto focus-visible:ring-0 resize-none text-sm"
            />
            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" onClick={onRemove}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
        </div>
    );
};

const EditableWorkflowList = ({ workflows, onWorkflowsChange, onApprove, isProcessing }: {
    workflows: string[];
    onWorkflowsChange: (workflows: string[]) => void;
    onApprove: () => void;
    isProcessing: boolean;
}) => {
    const [localWorkflows, setLocalWorkflows] = useState(workflows);

    useEffect(() => {
        setLocalWorkflows(workflows);
    }, [workflows]);

    const handleWorkflowChange = (index: number, value: string) => {
        const updated = [...localWorkflows];
        updated[index] = value;
        setLocalWorkflows(updated);
        onWorkflowsChange(updated);
    };

    const handleRemoveWorkflow = (index: number) => {
        const updated = localWorkflows.filter((_, i) => i !== index);
        setLocalWorkflows(updated);
        onWorkflowsChange(updated);
    };

    const handleAddWorkflow = () => {
        const updated = [...localWorkflows, ''];
        setLocalWorkflows(updated);
        onWorkflowsChange(updated);
    };

    return (
        <div className="mt-4 space-y-3 border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Edit3 className="h-4 w-4" />
                Edit workflow names below:
            </div>
            <div className="space-y-2">
                {localWorkflows.map((workflow, index) => (
                    <div key={index} className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground w-6">{index + 1}.</span>
                        <Input
                            value={workflow}
                            onChange={(e) => handleWorkflowChange(index, e.target.value)}
                            className="flex-1"
                            placeholder="Enter workflow name..."
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveWorkflow(index)}
                            className="h-8 w-8"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                ))}
            </div>
            <div className="flex justify-between items-center pt-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleAddWorkflow}
                    className="flex items-center gap-2"
                >
                    <PlusCircle className="h-4 w-4" />
                    Add Workflow
                </Button>
                <Button
                    onClick={onApprove}
                    disabled={isProcessing || localWorkflows.filter(w => w.trim()).length === 0}
                    className="flex items-center gap-2"
                >
                    {isProcessing && <RefreshCw className="h-4 w-4 animate-spin" />}
                    {isProcessing ? 'Processing...' : 'Approve & Generate Workflows'}
                </Button>
            </div>
        </div>
    );
};

const AiThinkingBubble = () => (
    <div className="flex items-start gap-3">
        <div className="p-3 rounded-lg bg-background border">
            <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce"></div>
            </div>
        </div>
    </div>
);

export default function WorkflowPage({ params }: { params: Promise<{ userId: string }> }) {
    const { userId } = use(params);
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
    const [combinedEvents, setCombinedEvents] = useState<CombinedEvent[]>([]);
    const [collapsedSections, setCollapsedSections] = useState({
        inputs: true,
        outputs: true,
        steps: true,
        businessLogic: true,
    });
    const [conversationId, setConversationId] = useState<string | null>(null);
    
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

    // Save conversation function that works with workflows endpoint
    const saveConversation = async (messagesToSave: Message[], step: SynthesisStep, workflowNames: string[]) => {
        if (!userId) return;
        
        try {
            const conversationData = {
                user_id: userId,
                title: '__CONVERSATION__',
                chat_history: {
                    messages: messagesToSave,
                    synthesis_step: step,
                    identified_workflow_names: workflowNames,
                    timestamp: new Date().toISOString()
                },
                inputs: [],
                outputs: [],
                steps: [],
                business_logic: []
            };

            if (conversationId) {
                // Update existing conversation
                await fetch(`/api/workflows/${conversationId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(conversationData)
                });
            } else {
                // Create new conversation
                const response = await fetch('/api/workflows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        workflows: [conversationData]
                    })
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.data && result.data[0]) {
                        setConversationId(result.data[0].id);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to save conversation:', error);
        }
    };

    // Auto-save conversation whenever messages change
    useEffect(() => {
        if (messages.length > 1) { // Don't save just the initial message
            const timeoutId = setTimeout(() => {
                saveConversation(messages, synthesisStep, identifiedWorkflowNames);
            }, 2000); // Debounce saves by 2 seconds

            return () => clearTimeout(timeoutId);
        }
    }, [messages, saveConversation]);

    const resetConversation = async () => {
        // Reset all state
        setMessages([
            { 
                id: 'init', 
                sender: 'ai', 
                text: "Hi! I can help you synthesize workflows from raw user events. I'll analyze your recorded events and help identify distinct workflows.\n\nClick the button below to begin:"
            }
        ]);
        setSynthesisStep('idle');
        setIdentifiedWorkflowNames([]);
        setCombinedEvents([]);
        setIsLoading(false);
        setIsAiThinking(false);
        setUserInput('');
        setConversationId(null);

        // Delete conversation from backend using workflows endpoint
        if (conversationId) {
            try {
                await fetch(`/api/workflows/${conversationId}`, {
                    method: 'DELETE'
                });
            } catch (error) {
                console.error('Failed to delete conversation:', error);
            }
        }
    };

    useEffect(() => {
        setUserId(userId);
    }, [userId, setUserId]);

    // Load saved conversation on mount
    useEffect(() => {
        const loadSavedConversation = async () => {
            if (!userId) return;
            
            try {
                // Use the existing workflows endpoint which returns all workflows including conversations
                const response = await fetch(`/api/workflows?userId=${userId}`);
                if (response.ok) {
                    const workflowsResponse = await response.json();
                    console.log('Loaded workflows data:', workflowsResponse);
                    
                    if (workflowsResponse.data) {
                        // Find conversation entry (workflow with title '__CONVERSATION__')
                        const conversationWorkflow = workflowsResponse.data.find((wf: { title: string; id: number; chat_history?: { messages?: Message[]; synthesis_step?: string; identified_workflow_names?: string[] } }) => wf.title === '__CONVERSATION__');
                        console.log('Found conversation workflow:', conversationWorkflow);
                        
                        if (conversationWorkflow && conversationWorkflow.chat_history) {
                            const chatHistory = conversationWorkflow.chat_history;
                            console.log('Chat history structure:', chatHistory);
                            
                            // Ensure messages is always an array
                            const loadedMessages = Array.isArray(chatHistory.messages) ? chatHistory.messages : 
                                                   Array.isArray(chatHistory) ? chatHistory : [];
                            console.log('Loaded messages:', loadedMessages);
                            console.log('Loaded messages type:', typeof loadedMessages, 'isArray:', Array.isArray(loadedMessages));
                            
                            // Restore conversation state with validation
                            if (Array.isArray(loadedMessages)) {
                                setMessages(loadedMessages);
                            } else {
                                console.error('Loaded messages is not an array:', loadedMessages);
                                setMessages([
                                    { 
                                        id: 'init', 
                                        sender: 'ai', 
                                        text: "Hi! I can help you synthesize workflows from raw user events. I'll analyze your recorded events and help identify distinct workflows.\n\nClick the button below to begin:"
                                    }
                                ]);
                            }
                            setSynthesisStep(chatHistory.synthesis_step || 'idle');
                            setIdentifiedWorkflowNames(chatHistory.identified_workflow_names || []);
                            setConversationId(conversationWorkflow.id);
                            
                            // If we have identified workflows but no canvas workflows, stay in chat mode
                            const actualWorkflows = workflowsResponse.data.filter((wf: { title: string }) => wf.title !== '__CONVERSATION__');
                            if (chatHistory.identified_workflow_names?.length > 0 && actualWorkflows.length === 0) {
                                setView('initial');
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load saved conversation:', error);
                // If loading fails, start fresh - don't break the app
                setMessages([
                    { 
                        id: 'init', 
                        sender: 'ai', 
                        text: "Hi! I can help you synthesize workflows from raw user events. I'll analyze your recorded events and help identify distinct workflows.\n\nClick the button below to begin:"
                    }
                ]);
            }
        };

        loadSavedConversation();
    }, [userId]);

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
            const response = await fetch(`/api/workflows?userId=${userId}`);
            if(response.ok) {
                const data = await response.json();
                if (data.data && data.data.length > 0) {
                    // Filter out conversation entries - only show actual workflows
                    const actualWorkflows = data.data.filter((wf: { title: string }) => wf.title !== '__CONVERSATION__');
                    setWorkflows(actualWorkflows);
                    if (actualWorkflows.length > 0) {
                        setView('canvas');
                    }
                }
            }
        } catch (error) {
            console.error("Failed to fetch workflows", error);
        } finally {
            setIsLoading(false);
        }
    }, [userId]);
    
    useEffect(() => {
        fetchWorkflows();
    }, [fetchWorkflows]);

    const startWorkflowIdentification = async () => {
        setIsLoading(true);
        setSynthesisStep('identifying');

        // 1. Fetch all annotated events from the previous tab's data source
        const eventDataResponse = await fetch(`/api/get-dataset-entries?userId=${userId}&datasetType=workflow_event_feedback`);
        const analysisResponse = await fetch(`/api/fetch-llm-analyses?userId=${userId}&limit=1000`);

        if (!eventDataResponse.ok || !analysisResponse.ok) {
            console.error("Failed to fetch necessary data");
            setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: "Sorry, I couldn't fetch the necessary data to begin analysis." }]);
            setIsLoading(false);
            setSynthesisStep('idle');
            return;
        }
        
        const eventData = await eventDataResponse.json();
        const analysisData = await analysisResponse.json();

        const combinedEvents: CombinedEvent[] = analysisData.analyses.map((analysis: WorkflowStepAnalysis) => {
            const eventFeedback = eventData.entries.find((e: FetchedEventEntry) => String(e.low_level_workflow_analysis_id) === String(analysis.id));
            return {
                analysis,
                generated_output: eventFeedback?.generated_output || null
            };
        }).filter((e: CombinedEvent) => e.generated_output);

        if (combinedEvents.length === 0) {
            setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: "There are no annotated events to analyze. Please go to the 'Labeling' tab and generate some event summaries first." }]);
            setIsLoading(false);
            setSynthesisStep('idle');
            return;
        }
        
        // Storing combinedEvents in state to be used by subsequent steps
        setCombinedEvents(combinedEvents);
        
        const response = await fetch('/api/identify-workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel, context: { events: combinedEvents } }),
        });

        if (response.ok) {
            const result = await response.json();
            setIdentifiedWorkflowNames(result.workflow_names || []);
            setMessages(prev => [...prev, { 
                id: 'workflow-list', 
                sender: 'ai', 
                text: "I've identified the following potential workflows. You can edit the names, remove unwanted workflows, or add new ones:"
            }]);
            setSynthesisStep('workflow_editing');
        } else {
            setMessages(prev => [...prev, { id: Date.now().toString(), sender: 'ai', text: "Sorry, I couldn't identify any distinct workflows from the provided events." }]);
            setSynthesisStep('idle');
        }
        setIsLoading(false);
    };

    const processAllWorkflows = async (approvedWorkflows: string[]) => {
        setIsLoading(true);
        setSynthesisStep('defining_boundaries');
        
        try {
            // Process each workflow: define boundaries then synthesize
            const workflowResults = [];
            
            for (const workflowName of approvedWorkflows) {
                if (!workflowName.trim()) continue;
                
                // Define boundaries for this workflow
                const boundariesResponse = await fetch('/api/define-workflow-boundaries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        model: selectedModel, 
                        context: { 
                            events: combinedEvents, 
                            target_workflow_name: workflowName
                        } 
                    }),
                });
                
                if (!boundariesResponse.ok) continue;
                
                const boundaries = await boundariesResponse.json();
                
                // Synthesize the workflow
                const synthesisResponse = await fetch('/api/synthesize-workflow', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: selectedModel,
                        context: { 
                            events: combinedEvents.filter(e => e.analysis.workflow === workflowName),
                            workflow_name: workflowName,
                            trigger: boundaries.trigger,
                            terminator: boundaries.terminator
                        }
                    }),
                });
                
                if (synthesisResponse.ok) {
                    const result = await synthesisResponse.json();
                    workflowResults.push(...(result.workflows || []));
                }
            }
            
            if (workflowResults.length > 0) {
                // Save all workflows
                await fetch('/api/workflows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, workflows: workflowResults }),
                });
                
                // Fetch and display workflows
                await fetchWorkflows();
                setSynthesisStep('done');
                
                setMessages(prev => [...prev, { 
                    id: Date.now().toString(), 
                    sender: 'ai', 
                    text: `Great! I've successfully generated ${workflowResults.length} workflow(s). You can now see them in the canvas and edit them as needed.`
                }]);
            } else {
                setMessages(prev => [...prev, { 
                    id: Date.now().toString(), 
                    sender: 'ai', 
                    text: "I wasn't able to generate any workflows from the selected names. Please try again or check if you have sufficient annotated events."
                }]);
                setSynthesisStep('idle');
            }
        } catch (error) {
            console.error('Error processing workflows:', error);
            setMessages(prev => [...prev, { 
                id: Date.now().toString(), 
                sender: 'ai', 
                text: "Sorry, something went wrong while processing the workflows. Please try again."
            }]);
            setSynthesisStep('idle');
        }
        
        setIsLoading(false);
    };

    const handleSendMessage = async () => {
        if (!userInput.trim()) return;
        const userMessage: Message = { id: Date.now().toString(), sender: 'user', text: userInput };
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
                        id: Date.now().toString(), 
                        sender: 'ai', 
                        text: "I've updated the workflow list based on your instruction. Please review the changes above."
                    }]);
                } else {
                    setMessages(prev => [...prev, { 
                        id: Date.now().toString(), 
                        sender: 'ai', 
                        text: "I couldn't process that instruction. Please try rephrasing or use the edit interface above."
                    }]);
                }
            } else {
                // Future: Handle other conversational edits when in canvas mode
                setMessages(prev => [...prev, { 
                    id: Date.now().toString(), 
                    sender: 'ai', 
                    text: "I understand you want to make changes, but I can only help during the workflow identification phase right now. Please use the direct editing interface in the canvas."
                }]);
            }
        } catch {
            const aiErrorResponse: Message = { id: (Date.now() + 1).toString(), sender: 'ai', text: "Sorry, something went wrong. Please try again." };
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
        setWorkflows(prev => prev.filter(wf => wf.id !== workflowId));
        setActiveWorkflowIndex(0);
    };

    if (view === 'initial' || view === 'chat_fullscreen') {
        const isChatMode = view === 'chat_fullscreen';
        return (
            <div className={`flex flex-col items-center justify-center h-[calc(100vh-10rem)] ${isChatMode ? 'w-full max-w-3xl mx-auto' : ''}`}>
                <Card className="w-full h-full flex flex-col">
                    <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/40">
                        <div className="w-64">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="w-full">
                                        {selectedModel}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuRadioGroup
                                        value={selectedModel}
                                        onValueChange={setSelectedModel}
                                    >
                                        <DropdownMenuRadioItem value="gemini-2.5-flash-preview-05-20">gemini-2.5-flash-preview-05-20</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="gemini-2.5-pro-preview-06-05">gemini-2.5-pro-preview-06-05</DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                        <CardTitle className="text-center flex-grow">AI Assistant</CardTitle>
                        <div className="w-64 flex justify-end">
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button 
                                            variant="outline" 
                                            size="sm" 
                                            onClick={resetConversation}
                                            className="flex items-center gap-2"
                                        >
                                            <RotateCcw className="h-4 w-4" />
                                            Reset
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Start over with a fresh conversation</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        </div>
                    </CardHeader>
                    <CardContent className="flex-grow overflow-y-auto p-4 space-y-4" ref={fullscreenChatRef}>
                        {Array.isArray(messages) && messages.map((message) => (
                            <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
                                <div className={`p-4 rounded-lg max-w-[80%] ${
                                    message.sender === 'ai' 
                                        ? 'bg-background border shadow-sm' 
                                        : 'bg-primary text-primary-foreground'
                                }`}>
                                    <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                                    {message.id === 'init' && (
                                        <Button 
                                            size="sm" 
                                            onClick={startWorkflowIdentification} 
                                            disabled={isLoading}
                                            className="mt-4"
                                        >
                                            {isLoading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            {isLoading ? 'Generating...' : 'Identify Workflows'}
                                        </Button>
                                    )}
                                    {message.id === 'workflow-list' && identifiedWorkflowNames.length > 0 && (
                                        <EditableWorkflowList
                                            workflows={identifiedWorkflowNames}
                                            onWorkflowsChange={setIdentifiedWorkflowNames}
                                            onApprove={() => processAllWorkflows(identifiedWorkflowNames)}
                                            isProcessing={isLoading}
                                        />
                                    )}
                                </div>
                            </div>
                        ))}
                        {isAiThinking && <AiThinkingBubble />}
                    </CardContent>
                    <CardFooter className="p-4 border-t">
                        <div className="relative w-full">
                            <Input 
                                placeholder={synthesisStep === 'workflow_editing' ? "Edit the workflow list above or type instructions like 'remove email workflow'..." : "Ask AI to edit the canvas..."} 
                                className="pr-20" 
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                disabled={isAiThinking}
                            />
                            <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isAiThinking}><Paperclip className="h-4 w-4" /></Button>
                                <Button size="sm" className="h-7" onClick={handleSendMessage} disabled={isAiThinking}><Send className="h-4 w-4" /></Button>
                            </div>
                        </div>
                    </CardFooter>
                </Card>
            </div>
        )
    }

    if (view === 'canvas' && workflows.length === 0) {
        return <div className="flex items-center justify-center h-[60vh]">No workflows identified.</div>
    }

    return (
        <div className="grid grid-cols-3 gap-2">
            {/* AI Assistant Sidebar */}
            <aside className="col-span-1 flex flex-col h-[calc(100vh-10rem)] bg-muted/40 border rounded-lg">
                <div className="p-4 border-b flex items-center justify-between">
                    <h3 className="text-base font-semibold">AI Assistant</h3>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button 
                                    variant="outline" 
                                    size="sm" 
                                    onClick={resetConversation}
                                    className="flex items-center gap-1"
                                >
                                    <RotateCcw className="h-3 w-3" />
                                    Reset
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>Start over with a fresh conversation</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="flex-grow p-4 space-y-2 overflow-y-auto" ref={sidebarChatRef}>
                    {Array.isArray(messages) && messages.map((message) => (
                        <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
                            <div className={`p-3 rounded-lg max-w-[80%] ${message.sender === 'ai' ? 'bg-background' : 'bg-primary text-primary-foreground'}`}>
                                <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                            </div>
                        </div>
                    ))}
                    {isAiThinking && <AiThinkingBubble />}
                </div>
                <div className="p-4 border-t bg-background">
                    <div className="relative">
                        <Input 
                            placeholder="Ask AI to edit the canvas..." 
                            className="pr-16" 
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            disabled={isAiThinking}
                        />
                        <div className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center">
                            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isAiThinking}><Paperclip className="h-4 w-4" /></Button>
                            <Button size="sm" className="h-7" onClick={handleSendMessage} disabled={isAiThinking}><Send className="h-4 w-4" /></Button>
                        </div>
                    </div>
                </div>
            </aside>
            
            {/* Main Canvas Area */}
            <main className="col-span-2 h-[calc(100vh-10rem)]">
                <Tabs value={String(activeWorkflowIndex)} onValueChange={(value) => setActiveWorkflowIndex(Number(value))} className="h-full flex flex-col">
                    <TabsList className="bg-transparent rounded-b-none -mb-px border-b">
                        <TooltipProvider>
                            {workflows.map((wf, index) => (
                                <Tooltip key={index}>
                                    <TooltipTrigger asChild>
                                        <div className="relative group">
                                            <TabsTrigger value={String(index)} className="pr-8">
                                                {wf.title.length > 20 ? `${wf.title.substring(0, 20)}...` : wf.title}
                                            </TabsTrigger>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="absolute top-1/2 right-0 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100">
                                                        <X className="h-3 w-3" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Are you sure you want to delete this workflow?</AlertDialogTitle>
                                                        <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDeleteWorkflow(wf.id)}>Delete</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>{wf.title}</p>
                                    </TooltipContent>
                                </Tooltip>
                            ))}
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-full" onClick={() => setView('initial')}>
                                        <PlusCircle className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>New Workflow</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </TabsList>
                    
                    {activeContent && (
                        <div className="border border-t-0 rounded-lg rounded-tl-none p-4 bg-background flex-grow overflow-y-auto">
                            <div className="flex items-center mb-4">
                               <Textarea 
                                    value={activeContent.title}
                                    onChange={(e) => handleTitleChange(e.target.value)}
                                    className="text-2xl font-bold border-0 p-0 h-auto focus-visible:ring-0 resize-none"
                                />
                            </div>
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <h3 className="text-base font-semibold flex items-center cursor-pointer" onClick={() => toggleSection('inputs')}>
                                        {collapsedSections.inputs ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                        Inputs
                                    </h3>
                                    {!collapsedSections.inputs && (
                                        <>
                                            <ul className="list-disc list-outside pl-5">
                                                {(activeContent.inputs || []).map((item, index) => {
                                                    const fieldKey = `${activeWorkflowIndex}-inputs`;
                                                    const itemRef = itemRefs[fieldKey]?.[index];
                                                    return (
                                                        <li key={index}>
                                                            <EditableListItem 
                                                                item={item} 
                                                                itemRef={itemRef}
                                                                onChange={(v) => handleListChange('inputs', index, v)} 
                                                                onRemove={() => handleRemoveItem('inputs', index)}
                                                                onEnter={() => handleAddItem('inputs', index)}
                                                                onBackspaceEmpty={() => handleRemoveItem('inputs', index)}
                                                            />
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('inputs', (activeContent.inputs || []).length - 1)} className="text-muted-foreground -ml-2"><PlusCircle className="h-4 w-4 mr-2" />Add Input</Button>
                                        </>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-base font-semibold flex items-center cursor-pointer" onClick={() => toggleSection('outputs')}>
                                        {collapsedSections.outputs ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                        Outputs
                                    </h3>
                                    {!collapsedSections.outputs && (
                                        <>
                                            <ul className="list-disc list-outside pl-5">
                                                {(activeContent.outputs || []).map((item, index) => {
                                                    const fieldKey = `${activeWorkflowIndex}-outputs`;
                                                    const itemRef = itemRefs[fieldKey]?.[index];
                                                    return (
                                                        <li key={index}>
                                                            <EditableListItem 
                                                                item={item} 
                                                                itemRef={itemRef}
                                                                onChange={(v) => handleListChange('outputs', index, v)} 
                                                                onRemove={() => handleRemoveItem('outputs', index)}
                                                                onEnter={() => handleAddItem('outputs', index)}
                                                                onBackspaceEmpty={() => handleRemoveItem('outputs', index)}
                                                            />
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('outputs', (activeContent.outputs || []).length - 1)} className="text-muted-foreground -ml-2"><PlusCircle className="h-4 w-4 mr-2" />Add Output</Button>
                                        </>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-base font-semibold flex items-center cursor-pointer" onClick={() => toggleSection('steps')}>
                                        {collapsedSections.steps ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                        Steps
                                    </h3>
                                    {!collapsedSections.steps && (
                                        <>
                                            <ol className="list-decimal list-outside pl-5">
                                                {(activeContent.steps || []).map((item, index) => {
                                                    const fieldKey = `${activeWorkflowIndex}-steps`;
                                                    const itemRef = itemRefs[fieldKey]?.[index];
                                                    return (
                                                        <li key={index}>
                                                            <EditableListItem 
                                                                item={item} 
                                                                itemRef={itemRef}
                                                                onChange={(v) => handleListChange('steps', index, v)} 
                                                                onRemove={() => handleRemoveItem('steps', index)}
                                                                onEnter={() => handleAddItem('steps', index)}
                                                                onBackspaceEmpty={() => handleRemoveItem('steps', index)}
                                                            />
                                                        </li>
                                                    )
                                                })}
                                            </ol>
                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('steps', (activeContent.steps || []).length - 1)} className="text-muted-foreground -ml-2"><PlusCircle className="h-4 w-4 mr-2" />Add Step</Button>
                                        </>
                                    )}
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-base font-semibold flex items-center cursor-pointer" onClick={() => toggleSection('businessLogic')}>
                                        {collapsedSections.businessLogic ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                        Business Logic
                                    </h3>
                                    {!collapsedSections.businessLogic && (
                                        <>
                                            <ul className="list-disc list-outside pl-5">
                                                {(activeContent.businessLogic || []).map((item, index) => {
                                                    const fieldKey = `${activeWorkflowIndex}-businessLogic`;
                                                    const itemRef = itemRefs[fieldKey]?.[index];
                                                    return (
                                                        <li key={index}>
                                                            <EditableListItem 
                                                                item={item} 
                                                                itemRef={itemRef}
                                                                onChange={(v) => handleListChange('businessLogic', index, v)} 
                                                                onRemove={() => handleRemoveItem('businessLogic', index)}
                                                                onEnter={() => handleAddItem('businessLogic', index)}
                                                                onBackspaceEmpty={() => handleRemoveItem('businessLogic', index)}
                                                            />
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('businessLogic', (activeContent.businessLogic || []).length - 1)} className="text-muted-foreground -ml-2"><PlusCircle className="h-4 w-4 mr-2" />Add Item</Button>
                                        </>
                                    )}
                                </div>
                            </div>
                       </div>
                    )}
                </Tabs>
            </main>
        </div>
    );
} 