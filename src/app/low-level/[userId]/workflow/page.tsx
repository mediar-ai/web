// This is a test comment to see if the file can be edited.
'use client';

import { useState, useEffect, use, createRef, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Send, PlusCircle, Trash2, RefreshCw, X, ChevronRight, ChevronDown, Edit3, RotateCcw, Edit2 } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import type { LowLevelEvent } from '@/types';

type Message = {
    id: string;
    sender: 'user' | 'ai' | 'ai-thinking';
    text: string;
}

type CanvasContent = {
    id: number;
    title: string | null;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
    chat_history: Message[];
}

type SynthesizedWorkflow = {
    title: string;
    inputs: string[];
    outputs: string[];
    steps: string[];
    businessLogic: string[];
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
    feedback: 'good' | 'bad' | 'irrelevant' | null;
    contextSummary: {
        windowTitle: string;
        eventCount: number;
    };
    timestamp: Date;
}

type FinalAnalysisData = {
    workflowNames?: string[];
    workflowContext?: WorkflowContext;
}

type SynthesisStep = 'idle' | 'identifying' | 'workflow_editing' | 'defining_boundaries' | 'boundaries_editing' | 'synthesizing' | 'done' | 'refining';

type WorkflowContext = {
  user_job_role: string;
  project_name: string;
  project_goal: string;
};

type WorkflowBoundary = {
  trigger: string;
  terminator: string;
};

type WorkflowBoundaries = Record<string, WorkflowBoundary>;

type WorkflowDataObject = {
    id: number;
    title: string;
    chat_history: {
        messages: Message[];
        synthesis_step: SynthesisStep;
        identified_workflow_names: string[];
        workflow_context: WorkflowContext;
        workflow_boundaries?: WorkflowBoundaries;
    }
}

type DatabaseWorkflow = {
    id: number;
    title: string | null;
    inputs: string[];
    outputs: string[];
    steps: string[];
    business_logic: string[];
    chat_history: Message[];
}

type SynthesisSession = {
    id: number;
    user_id: string;
    session_state: {
        messages: Message[];
        synthesis_step: SynthesisStep;
        identified_workflow_names: string[];
        workflow_context: WorkflowContext;
        workflow_boundaries?: WorkflowBoundaries;
    }
}

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
    const handleWorkflowChange = (index: number, value: string) => {
        const updated = [...workflows];
        updated[index] = value;
        onWorkflowsChange(updated);
    };

    const handleRemoveWorkflow = (index: number) => {
        const updated = workflows.filter((_, i) => i !== index);
        onWorkflowsChange(updated);
    };

    const handleAddWorkflow = () => {
        const updated = [...workflows, ''];
        onWorkflowsChange(updated);
    };

    return (
        <div className="mt-4 space-y-3 border rounded-lg p-4 bg-muted/20">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Edit3 className="h-4 w-4" />
                Edit workflow names below:
            </div>
            <div className="space-y-2">
                {workflows.map((workflow, index) => (
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
                    disabled={isProcessing || workflows.filter(w => w.trim()).length === 0}
                    className="flex items-center gap-2"
                >
                    {isProcessing && <RefreshCw className="h-4 w-4 animate-spin" />}
                    {isProcessing ? 'Processing...' : 'Approve & Generate Boundaries'}
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

const AnalysisProgressBubble = ({ status, progress, elapsedTime }: { status: string, progress: number, elapsedTime: number }) => (
    <div className="flex items-start gap-3 w-full">
        <div className="p-4 rounded-lg bg-background border w-full max-w-2xl">
            <div className="flex items-center gap-3">
                <RefreshCw className="h-5 w-5 text-primary animate-spin" />
                <div className="flex-1">
                    <p className="font-medium text-sm text-foreground">{status}</p>
                    <p className="text-xs text-muted-foreground">Elapsed time: {elapsedTime.toFixed(1)}s</p>
                </div>
            </div>
            <Progress value={progress} className="mt-3 h-2" />
        </div>
    </div>
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const EditableWorkflowBoundaries = ({ boundaries, onBoundariesChange, onApprove, isProcessing }: {
    boundaries: WorkflowBoundaries;
    onBoundariesChange: (boundaries: WorkflowBoundaries) => void;
    onApprove: () => void;
    isProcessing: boolean;
}) => {
    const handleBoundaryChange = (workflowName: string, field: 'trigger' | 'terminator', value: string) => {
        const newBoundaries = {
            ...boundaries,
            [workflowName]: {
                ...boundaries[workflowName],
                [field]: value
            }
        };
        onBoundariesChange(newBoundaries);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Edit2 className="h-4 w-4" />
                <span>Review and edit workflow boundaries below:</span>
            </div>
            
            <div className="space-y-6">
                {Object.entries(boundaries).map(([workflowName, boundary]) => (
                    <Card key={workflowName} className="p-4">
                        <h4 className="font-medium mb-3">{workflowName}</h4>
                        <div className="space-y-3">
                            <div>
                                <Label htmlFor={`trigger-${workflowName}`} className="text-sm font-medium">
                                    Trigger (How this workflow starts)
                                </Label>
                                <Textarea
                                    id={`trigger-${workflowName}`}
                                    value={boundary.trigger}
                                    onChange={(e) => handleBoundaryChange(workflowName, 'trigger', e.target.value)}
                                    className="mt-1"
                                    rows={2}
                                />
                            </div>
                            <div>
                                <Label htmlFor={`terminator-${workflowName}`} className="text-sm font-medium">
                                    Terminator (How this workflow ends)
                                </Label>
                                <Textarea
                                    id={`terminator-${workflowName}`}
                                    value={boundary.terminator}
                                    onChange={(e) => handleBoundaryChange(workflowName, 'terminator', e.target.value)}
                                    className="mt-1"
                                    rows={2}
                                />
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
            
            <div className="flex justify-center">
                <Button 
                    onClick={onApprove}
                    disabled={isProcessing}
                    className="bg-green-600 hover:bg-green-700 text-white"
                >
                    {isProcessing ? (
                        <>
                            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            Synthesizing...
                        </>
                    ) : (
                        'Approve & Synthesize Workflows'
                    )}
                </Button>
            </div>
        </div>
    );
};

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
    const [isConversationLoaded, setIsConversationLoaded] = useState(false);
    
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
            const response = await fetch(`/api/synthesis-sessions?userId=${userId}`);
            if (response.ok) {
                const result = await response.json();
                const session: SynthesisSession = result.data;

                if (session && session.session_state) {
                    const { session_state } = session;
                    
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
                }
            }
        } catch (error) {
            console.error("Error loading synthesis session:", error);
        } finally {
            setIsConversationLoaded(true);
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
                id: Date.now().toString(), 
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
                const synthesizedMessage: Message = {id: Date.now().toString(), sender: 'ai', text: "Workflows have been synthesized. You can now view and refine them in the Canvas tab."};
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
                    throw new Error('Failed to update workflow list');
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

    // Auto-save when certain states change, with debouncing
    useEffect(() => {
        if (!isConversationLoaded) return; // Don't save until initial load is complete

        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            if (synthesisStep !== 'idle' || messages.length > 1 || Object.keys(workflowBoundaries).length > 0) {
                saveSynthesisSession(messages, synthesisStep, identifiedWorkflowNames, workflowContext, workflowBoundaries);
            }
        }, 1000); // 1-second debounce

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [messages, synthesisStep, identifiedWorkflowNames, workflowContext, workflowBoundaries, saveSynthesisSession, isConversationLoaded]);

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
                        <div className="w-64 flex justify-end gap-2 pr-4">
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
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                    <Button 
                                        variant="destructive" 
                                        size="sm"
                                        className="flex items-center gap-2"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Delete All
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Delete All Workflows & Session</AlertDialogTitle>
                                        <AlertDialogDescription>
                                            This will permanently delete the current synthesis session and ALL associated workflows for this user. This action cannot be undone.
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={deleteAllWorkflows}>
                                            Delete All Workflows & Session
                                        </AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
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
                                        <Button onClick={startWorkflowIdentification} disabled={isLoading || isAiThinking || combinedEvents.length === 0 || isFetchingEvents} className="mt-4">
                                            {(isLoading || isAiThinking || isFetchingEvents) && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                                            { isFetchingEvents ? "Loading Events..." : (isAnalyzingEvents ? "Analyzing..." : "Analyze Events") }
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
                                {message.id === 'analyzing' && isAnalyzingEvents && (
                                    <AnalysisProgressBubble 
                                        status={analysisStatus}
                                        progress={analysisProgress}
                                        elapsedTime={elapsedTime}
                                    />
                                )}
                                {message.sender === 'ai-thinking' && !isAnalyzingEvents && <AiThinkingBubble />}
                                
                                {/* Show workflow context analysis right after context-summary message */}
                                {message.id === 'context-summary' && workflowContext && editableContext && (workflowContext.user_job_role || workflowContext.project_name || workflowContext.project_goal) && (
                                    <div className="p-4 border rounded-lg bg-muted/50 mt-2">
                                        <h3 className="text-lg font-semibold mb-2">Workflow Context Analysis</h3>
                                        <p className="text-sm text-muted-foreground mb-4">
                                            The AI has analyzed your activities. You can review and edit this context.
                                        </p>
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-4">
                                                <Label htmlFor="jobRole" className="w-24 text-right">Your Job Role</Label>
                                                <Input id="jobRole" value={editableContext.user_job_role} onChange={(e) => handleContextChange('user_job_role', e.target.value)} />
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <Label htmlFor="projectName" className="w-24 text-right">Project Name</Label>
                                                <Input id="projectName" value={editableContext.project_name} onChange={(e) => handleContextChange('project_name', e.target.value)} />
                                            </div>
                                            <div className="flex items-start gap-4">
                                                <Label htmlFor="projectGoal" className="w-24 text-right pt-2">Project Goal</Label>
                                                <Textarea 
                                                    id="projectGoal" 
                                                    value={editableContext.project_goal} 
                                                    onChange={(e) => handleContextChange('project_goal', e.target.value)}
                                                    className="min-h-[80px] px-3 py-1"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                        
                        {/* Show workflow list when loaded from database - not dependent on specific message */}
                        {synthesisStep === 'identifying' && identifiedWorkflowNames.length > 0 && !messages.some(m => m.id === 'workflow-list') && (
                            <div className="flex items-start gap-3">
                                <div className="p-4 rounded-lg max-w-[80%] bg-background border shadow-sm">
                                    <p className="text-sm mb-4">Here are the workflows I identified:</p>
                                    <EditableWorkflowList
                                        workflows={identifiedWorkflowNames}
                                        onWorkflowsChange={setIdentifiedWorkflowNames}
                                        onApprove={() => processAllWorkflows(identifiedWorkflowNames)}
                                        isProcessing={isLoading}
                                    />
                                </div>
                            </div>
                        )}
                        
                        {/* Show workflow boundaries when they need approval */}
                        {synthesisStep === 'boundaries_editing' && Object.keys(workflowBoundaries).length > 0 && (
                            <div className="flex items-start gap-3">
                                <div className="p-4 rounded-lg max-w-[80%] bg-background border shadow-sm">
                                    <p className="text-sm mb-4">Here are the workflow boundaries I defined:</p>
                                    <EditableWorkflowBoundaries
                                        boundaries={workflowBoundaries}
                                        onBoundariesChange={setWorkflowBoundaries}
                                        onApprove={() => proceedToSynthesis(workflowBoundaries)}
                                        isProcessing={isLoading}
                                    />
                                </div>
                            </div>
                        )}
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
                    <div className="flex gap-2">
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
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button 
                                    variant="destructive" 
                                    size="sm"
                                    className="flex items-center gap-1"
                                >
                                    <Trash2 className="h-3 w-3" />
                                    Delete All
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete All Workflows & Session</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently delete the current synthesis session and ALL associated workflows for this user. This action cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={deleteAllWorkflows}>
                                        Delete All Workflows & Session
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                </div>
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
                                                {(wf.title || '').length > 20 ? `${(wf.title || '').substring(0, 20)}...` : (wf.title || 'Untitled')}
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
                                        <p>{wf.title || 'Untitled'}</p>
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
                                    value={activeContent.title || 'Untitled Workflow'}
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