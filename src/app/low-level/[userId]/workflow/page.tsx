'use client';
/* eslint-disable @typescript-eslint/no-unused-vars */

import { useState, useEffect, use, createRef, useCallback, useRef, useMemo, memo } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Send, PlusCircle, Trash2, RefreshCw, X, ChevronRight, ChevronDown, ChevronUp, Edit3, RotateCcw, Edit2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUser } from '@/context/UserContext';
import { Loader2 } from 'lucide-react';
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
import { Card, CardHeader, CardTitle, CardContent, CardFooter, CardDescription } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import type { CanvasContent, SynthesizedWorkflow, WorkflowStepAnalysis, FinalAnalysisData, SynthesisStep, WorkflowContext, WorkflowBoundary, WorkflowBoundaries, WorkflowDataObject, DatabaseWorkflow, SynthesisSession, Message } from './types';
import { useWorkflowPageLogic } from './useWorkflowPageLogic';
import {
  EditableListItem,
  EditableWorkflowList,
  AiThinkingBubble,
  AnalysisProgressBubble,
  EditableWorkflowBoundaries,
} from './components';
import React from 'react';
import { cn } from '@/lib/utils';

// Refactored components and shared types now live in dedicated files. They are
// imported where needed in other modules. To avoid duplicate identifier
// conflicts inside this file (which still contains the original definitions),
// we do NOT import them here.

const LoadingOverlay = () => (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="flex items-center gap-4 text-lg font-semibold text-foreground">
            <RefreshCw className="h-6 w-6 animate-spin" />
            <p>Loading Events...</p>
        </div>
    </div>
);

type WorkflowPageLogicType = ReturnType<typeof useWorkflowPageLogic>;

type StepDefinition = {
  id: string;
  title: string;
  description: string;
};

type StepId = 'define-context' | 'select-workflows' | 'define-boundaries' | 'synthesize-workflows';

const STEP_DEFINITIONS: StepDefinition[] = [
  {
    id: 'define-context',
    title: 'Step 1: Analyze Context & Draft Workflows',
    description: 'Understand the user\'s environment and goals, then draft initial workflow names.',
  },
  {
    id: 'select-workflows',
    title: 'Step 2: Select & Refine Workflows',
    description: 'Choose the workflows to proceed with and refine their names.',
  },
  {
    id: 'define-boundaries',
    title: 'Step 3: Define Workflow Boundaries',
    description: 'Review and adjust the start and end points for each identified workflow.',
  },
  {
    id: 'synthesize-workflows',
    title: 'Step 4: Synthesize Workflows',
    description: 'Generate detailed steps and actions for the approved workflows.',
  },
];

const StepperItem = memo(({
  id, number, title, description, isLast, logic
}: {
  id: string;
  number: number;
  title: string;
  description: string;
  isLast: boolean;
  logic: WorkflowPageLogicType;
}) => {
    const { 
      synthesisStep, isFetchingEvents, isAnalyzingEvents, runInitialAnalysis, isLoading, 
      refineAndIdentifyWorkflows, identifiedWorkflowNames, processAllWorkflows, 
      workflowBoundaries, proceedToSynthesis,
    } = logic;

    const actionMap: Record<string, (() => void) | undefined> = {
        'define-context': runInitialAnalysis,
        'select-workflows': refineAndIdentifyWorkflows,
        'define-boundaries': () => processAllWorkflows(identifiedWorkflowNames),
    };

    const stepState = useMemo(() => {
        const completedStates: Record<StepId, SynthesisStep[]> = {
  'define-context': ['context_editing', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'],
  'select-workflows': ['defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'],
  'define-boundaries': ['synthesizing', 'done'],
  'synthesize-workflows': ['done'],
};

        const enabledStates = {
            'define-context': !isFetchingEvents,
            'select-workflows': synthesisStep === 'context_editing',
            'define-boundaries': ['workflow_editing', 'defining_boundaries', 'boundaries_editing'].includes(synthesisStep) && identifiedWorkflowNames.length > 0,
        };
        
        // Active states should only be true when actual processing is happening (for spinning animation)
        const getActiveState = (stepId: StepId): boolean => {
            switch (stepId) {
                case 'define-context':
                    return isAnalyzingEvents; // Only active when actually analyzing
                case 'select-workflows':
                    return synthesisStep === 'identifying'; // Only active when identifying workflows
                case 'define-boundaries':
                    return synthesisStep === 'defining_boundaries'; // Only active when defining boundaries
                case 'synthesize-workflows':
                    return synthesisStep === 'synthesizing'; // Only active when synthesizing
                default:
                    return false;
            }
        };

        // Separate logic for when fields should be editable
        const getEditableState = (stepId: StepId): boolean => {
            switch (stepId) {
                case 'define-context':
                    return isAnalyzingEvents || synthesisStep === 'context_editing'; // Editable when analyzing OR editing context
                case 'select-workflows':
                    return synthesisStep === 'identifying' || synthesisStep === 'workflow_editing'; // Editable when processing or editing
                case 'define-boundaries':
                    return synthesisStep === 'defining_boundaries' || synthesisStep === 'boundaries_editing'; // Editable when processing or editing
                default:
                    return false;
            }
        };

        const showComponentStates = {
            'define-context': ['context_editing', 'identifying', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'select-workflows': ['workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'define-boundaries': ['boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
        };

        const active = getActiveState(id as StepId);
        const editable = getEditableState(id as StepId);
        
        return {
            completed: (completedStates[id as keyof typeof completedStates] || []).includes(synthesisStep),
            active: active,
            editable: editable,
            enabled: enabledStates[id as keyof typeof enabledStates] ?? false,
            showComponent: showComponentStates[id as keyof typeof showComponentStates] ?? false,
        };
    }, [id, synthesisStep, isFetchingEvents, isAnalyzingEvents, identifiedWorkflowNames]);
    
    const { completed, active, editable, enabled, showComponent } = stepState;
    const action = actionMap[id];
    const [isCollapsed, setIsCollapsed] = useState(true);

    const shouldBeExpanded = 
        (id === 'define-context' && (synthesisStep === 'context_editing' || isAnalyzingEvents)) ||
        (id === 'select-workflows' && synthesisStep === 'workflow_editing') ||
        (id === 'define-boundaries' && synthesisStep === 'boundaries_editing') ||
        (id === 'synthesize-workflows' && synthesisStep === 'synthesizing');



    useEffect(() => {
        if (shouldBeExpanded) {
            setIsCollapsed(false);
        } else if (completed) {
            setIsCollapsed(true);
        }
    }, [shouldBeExpanded, completed]);

    return (
        <div className="relative">
            {!isLast && <div className="absolute left-6 top-12 -bottom-4 w-0.5 bg-gray-300"></div>}
            
            <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold transition-all duration-200 border-2 ${
                    completed ? 'bg-black text-white border-black' : active ? 'bg-white text-black border-black' : enabled ? 'bg-gray-100 text-gray-900 border-gray-400' : 'bg-gray-50 text-gray-400 border-gray-200'
                }`}>
                    {active ? <RefreshCw className="h-6 w-6 animate-spin" strokeWidth={2} /> : number}
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold">{title}</h3>
                            <p className="text-sm text-muted-foreground">{description}</p>
                        </div>
                        
                        {action && enabled && !completed && (
                            <Button onClick={action} disabled={isLoading} className="ml-4">
                                {isLoading && active ? (
                                    <><RefreshCw className="mr-2 h-5 w-5 animate-spin" strokeWidth={2} />Processing...</>
                                ) : (
                                    title
                                )}
                            </Button>
                        )}
                        
                        {(showComponent || (completed && !active)) && (
                            <Button variant="ghost" size="sm" onClick={() => setIsCollapsed(!isCollapsed)} className="ml-2">
                                {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                            </Button>
                        )}
                    </div>
                    
                    {!isCollapsed && (
                      <div className="mt-4">
                        {id === 'define-context' && isAnalyzingEvents ? (
                            <AnalysisProgressBubble status={logic.analysisStatus} progress={logic.analysisProgress} elapsedTime={logic.elapsedTime} />
                        ) : showComponent ? (
                            <div className="p-4 border rounded-lg bg-muted/50">
                                {id === 'define-context' && (
                                    <div className={completed && !editable ? 'opacity-60 pointer-events-none' : ''}>
                                        <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2">
                                            <Label htmlFor="jobRole" className="text-right pt-2">Your Job Role</Label>
                                            <Input id="jobRole" value={logic.editableContext?.user_job_role || ''} onChange={(e) => logic.handleContextChange('user_job_role', e.target.value)} disabled={!editable} />
                                            
                                            <Label htmlFor="projectName" className="text-right pt-2">Project Name</Label>
                                            <Input id="projectName" value={logic.editableContext?.project_name || ''} onChange={(e) => logic.handleContextChange('project_name', e.target.value)} disabled={!editable} />
                                            
                                            <Label htmlFor="userGoal" className="text-right pt-2">User Goal (from recordings)</Label>
                                            <Textarea id="userGoal" value={logic.editableContext?.user_goal_from_recordings || ''} onChange={(e) => logic.handleContextChange('user_goal_from_recordings', e.target.value)} className="min-h-[60px]" disabled={!editable} />
                                            
                                            <Label htmlFor="overallGoal" className="text-right pt-2">Overall Project Goal</Label>
                                            <Textarea id="overallGoal" value={logic.editableContext?.overall_project_goal || ''} onChange={(e) => logic.handleContextChange('overall_project_goal', e.target.value)} className="min-h-[60px]" disabled={!editable} />
                                            
                                            <Label htmlFor="overallDesc" className="text-right pt-2">Overall Project Description</Label>
                                            <Textarea id="overallDesc" value={logic.editableContext?.overall_project_description || ''} onChange={(e) => logic.handleContextChange('overall_project_description', e.target.value)} className="min-h-[80px]" disabled={!editable} />
                                        </div>
                                    </div>
                                )}
                                
                                {id === 'select-workflows' && (
                                    <div className={completed ? 'opacity-60 pointer-events-none' : ''}>
                                        <EditableWorkflowList workflows={logic.identifiedWorkflowNames} onWorkflowsChange={logic.setIdentifiedWorkflowNames} />
                                    </div>
                                )}
                                
                                {id === 'define-boundaries' && (
                                    <div className={completed && !editable ? 'opacity-60 pointer-events-none' : ''}>
                                        <EditableWorkflowBoundaries boundaries={logic.workflowBoundaries} onBoundariesChange={logic.setWorkflowBoundaries} />
                                        {['boundaries_editing', 'synthesizing'].includes(synthesisStep) && (
                                            <CardFooter className="flex justify-between">
                                              <Button onClick={logic.goBackToWorkflowEditing} disabled={logic.isLoading || logic.synthesisStep !== 'boundaries_editing'}>Back</Button>
                                              <Button onClick={logic.confirmBoundaries} disabled={logic.isLoading || logic.synthesisStep !== 'boundaries_editing'}>
                                                {logic.synthesisStep === 'synthesizing' ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Synthesizing...</> : 'Confirm Boundaries & Synthesize'}
                                              </Button>
                                            </CardFooter>
                                        )}
                                    </div>
                                )}
                                
                                {id === 'synthesize-workflows' && (
                                  <Card>
                                    <CardContent>
                                      {logic.synthesisStep === 'defining_boundaries' ? (
                                        <div className="flex items-center space-x-2">
                                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                          <span>Defining initial boundaries...</span>
                                        </div>
                                      ) : (
                                        <div>
                                          <h3 className="font-semibold">Current Workflows:</h3>
                                          <ul className="list-disc pl-5 mt-2">
                                            {logic.identifiedWorkflowNames.map(name => <li key={name}>{name}</li>)}
                                          </ul>
                                        </div>
                                      )}
                                    </CardContent>
                                    {['boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep) && (
                                      <CardFooter className="flex justify-between">
                                        <Button onClick={logic.goBackToWorkflowEditing} disabled={logic.isLoading || logic.synthesisStep !== 'boundaries_editing'}>Back</Button>
                                        <Button onClick={logic.confirmBoundaries} disabled={logic.isLoading || logic.synthesisStep !== 'boundaries_editing'}>
                                          {logic.synthesisStep === 'synthesizing' ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Synthesizing...</> : 'Confirm Boundaries & Synthesize'}
                                        </Button>
                                      </CardFooter>
                                    )}
                                  </Card>
                                )}
                            </div>
                        ) : null}
                      </div>
                    )}
                </div>
            </div>
        </div>
    );
});
StepperItem.displayName = 'StepperItem';

const Stepper = ({ logic }: { logic: WorkflowPageLogicType }) => {
  const { synthesisStep, isFetchingEvents } = logic;
  const [isStepperCollapsed, setIsStepperCollapsed] = useState(true);

  useEffect(() => {
    if (synthesisStep !== 'done') {
      setIsStepperCollapsed(false);
    } else {
      setIsStepperCollapsed(true);
    }
  }, [synthesisStep]);

  // Show stats above the stepper when in idle state
  const showStatsCard = synthesisStep === 'idle' && !isFetchingEvents;

  return (
    <div className="w-full">
      {/* Stats Card - shown when in idle state */}
      {showStatsCard && (
        <div className="w-full p-8 text-center mb-6">
          <Card>
            <CardContent>
              {logic.userStats && (
                  <div className="mb-4 text-left">
                      <h3 className="text-lg font-semibold mb-2">User Stats</h3>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                          <div className="bg-muted p-3 rounded-lg">
                              <p className="text-muted-foreground">Total Events</p>
                              <p className="font-bold text-2xl">{logic.userStats.totalEvents}</p>
                          </div>
                          <div className="bg-muted p-3 rounded-lg">
                              <p className="text-muted-foreground">Timeline Steps Processed</p>
                              <p className="font-bold text-2xl">{logic.userStats.stepsProcessed} / {logic.userStats.totalSteps}</p>
                          </div>
                          <div className="bg-muted p-3 rounded-lg">
                              <p className="text-muted-foreground">LLM Labeled / Human Labeled</p>
                              <p className="font-bold text-2xl">{logic.userStats.labelingTotal} / {logic.userStats.humanLabeled}</p>
                          </div>
                      </div>
                  </div>
              )}
              <div className="mb-4 text-left">
                <h3 className="text-lg font-semibold mb-2">Loaded Data Stats</h3>
                {isFetchingEvents ? (
                  <div className="flex items-center justify-center h-24">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-muted p-3 rounded-lg">
                      <p className="text-muted-foreground">Timeline Steps Loaded</p>
                      <p className="font-bold text-2xl">{logic.rawAnalyses.length}</p>
                    </div>
                    <div className="bg-muted p-3 rounded-lg">
                      <p className="text-muted-foreground">LLM Labeled</p>
                      <p className="font-bold text-2xl">{logic.llmLabels.length}</p>
                    </div>
                    {logic.rawAnalyses.length > 0 && (
                      <>
                        <div className="bg-muted p-3 rounded-lg">
                          <p className="text-muted-foreground">From</p>
                          <p className="font-bold text-xl">{new Date(logic.rawAnalyses[logic.rawAnalyses.length - 1].client_timestamp).toLocaleString()}</p>
                        </div>
                        <div className="bg-muted p-3 rounded-lg">
                          <p className="text-muted-foreground">To</p>
                          <p className="font-bold text-xl">{new Date(logic.rawAnalyses[0].client_timestamp).toLocaleString()}</p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Collapsible header for completed workflows */}
      {synthesisStep === 'done' && logic.workflows.length > 0 && (
        <div className="mx-auto border-b pb-1 mb-1">
          <div
            className="flex justify-between items-center cursor-pointer"
            onClick={() => setIsStepperCollapsed(!isStepperCollapsed)}
          >
            <h2 className="text-xl font-semibold">Workflow Setup ({STEP_DEFINITIONS.length} Steps Completed)</h2>
            <Button variant="ghost" size="sm">
              {isStepperCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {/* Always show the stepper unless collapsed */}
      {!isStepperCollapsed && (
        <div className="max-w-4xl mx-auto py-6">
          <div className="space-y-8">
            {STEP_DEFINITIONS.map((step, index) => (
              <StepperItem
                key={step.id}
                id={step.id}
                number={index + 1}
                title={step.title}
                description={step.description}
                isLast={index === STEP_DEFINITIONS.length - 1}
                logic={logic}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default function WorkflowPage({ params }: { params: Promise<{ userId:string }> }) {
    const { userId } = use(params);
    const logic: WorkflowPageLogicType = useWorkflowPageLogic(userId);

    const {
        view, setView, workflows, setWorkflows, activeWorkflowIndex, setActiveWorkflowIndex,
        messages, setMessages, userInput, setUserInput, selectedModel, setSelectedModel,
        identifiedWorkflowNames, workflowContext, collapsedSections, toggleSection,
        isAnalyzingEvents, isLoading, synthesisStep, setSynthesisStep,
        rawAnalyses, workflowBoundaries,
        processAllWorkflows, proceedToSynthesis, handleSendMessage, handleListChange,
        draftWorkflowNames, setDraftWorkflowNames, confirmBoundaries,
        elapsedTime, isFetchingEvents,
        // New timeline mapping state
        timelineMappingMode, setTimelineMappingMode, timelineEvents,
        // Timeline view mode functions
        convertTimelineMappingsToWorkflows, updateCanvasWithTimelineMappings
    } = logic;

    return (
        <div className="h-full bg-background flex flex-col relative">
            {/* Header */}
            <div className="border-b bg-muted/40 p-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
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
                                    <DropdownMenuRadioItem value="gemini-2.5-flash">gemini-2.5-flash</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="gemini-2.5-pro">gemini-2.5-pro</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <h1 className="text-2xl font-bold">Workflow Synthesis</h1>
                    <div className="w-64 flex justify-end gap-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={logic.resetConversation}
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
                                    <AlertDialogAction onClick={logic.deleteAllWorkflows}>
                                        Delete All Workflows & Session
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className="p-6 flex-grow flex flex-col overflow-hidden items-center">
                <Stepper logic={logic} />

                {synthesisStep === 'done' && workflows.length > 0 && (
                    <div className="pt-4 grid grid-cols-3 gap-6 flex-grow min-h-0 w-full max-w-7xl">
                    {/* AI Assistant Sidebar */}
                        <aside className="col-span-1 flex flex-col bg-muted/40 border rounded-lg overflow-hidden">
                        <div className="p-4 border-b">
                            <h3 className="text-base font-semibold">AI Assistant</h3>
                        </div>
                        
                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {Array.isArray(messages) && messages.map((message) => (
                                <div key={message.id} className={`flex items-start gap-3 ${message.sender === 'user' ? 'justify-end' : ''}`}>
                                    <div className={`p-3 rounded-lg max-w-[80%] ${
                                        message.sender === 'ai' 
                                            ? 'bg-background border shadow-sm' 
                                            : 'bg-primary text-primary-foreground'
                                    }`}>
                                        <p className="text-sm whitespace-pre-wrap">{message.text}</p>
                                    </div>
                                </div>
                            ))}
                            {logic.isAiThinking && <AiThinkingBubble />}
                        </div>
                        
                        {/* Chat Input */}
                        <div className="p-4 border-t">
                            <div className="relative">
                                <Textarea 
                                    placeholder="Ask AI for help with workflows..." 
                                    className="min-h-[60px] pr-12" 
                                    value={userInput}
                                    onChange={(e) => setUserInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), logic.handleSendMessage())}
                                    disabled={logic.isAiThinking}
                                />
                                <Button 
                                    size="sm" 
                                    className="absolute bottom-2 right-2 h-8" 
                                    onClick={logic.handleSendMessage} 
                                    disabled={logic.isAiThinking || !userInput.trim()}
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </aside>

                    {/* Main Canvas Area */}
                        <div className="col-span-2 overflow-y-auto relative">
                        {/* Synthesized Workflows Section */}
                            <div>
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-2xl font-bold">Workflow Canvas</h2>
                                    <div className="flex items-center gap-4">
                                        {/* Timeline Mapping Mode Toggle */}
                                        {logic.timelineMappingMode && (
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-muted-foreground">Timeline Mode:</span>
                                                <Button
                                                    variant={logic.timelineMappingMode ? "default" : "outline"}
                                                    size="sm"
                                                    onClick={() => logic.setTimelineMappingMode(!logic.timelineMappingMode)}
                                                >
                                                    📊 Timeline View
                                                </Button>
                                            </div>
                                        )}
                                        <div className="text-sm text-muted-foreground">
                                            {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} generated
                                            {logic.timelineEvents?.length > 0 && (
                                                <span className="ml-2">• {logic.timelineEvents.length} events mapped</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Timeline Mapping Summary (when in timeline mode) */}
                                {logic.timelineMappingMode && logic.timelineEvents?.length > 0 && (
                                    <div className="mb-6 p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/30">
                                        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">📈 Timeline Mapping Summary</h3>
                                        <div className="grid grid-cols-4 gap-4 text-sm">
                                            <div>
                                                <span className="text-muted-foreground">Total Events:</span>
                                                <div className="font-semibold">{logic.timelineEvents.length}</div>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Workflow Related:</span>
                                                <div className="font-semibold text-green-600">
                                                    {logic.timelineEvents.filter(e => e.is_workflow_related).length}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Unrelated:</span>
                                                <div className="font-semibold text-gray-500">
                                                    {logic.timelineEvents.filter(e => !e.is_workflow_related).length}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">Avg Confidence:</span>
                                                <div className="font-semibold">
                                                    {logic.timelineEvents.length > 0 ? 
                                                        Math.round((logic.timelineEvents
                                                            .filter(e => e.confidence_score)
                                                            .reduce((sum, e) => sum + (e.confidence_score || 0), 0) / 
                                                            logic.timelineEvents.filter(e => e.confidence_score).length) * 100) + '%'
                                                        : 'N/A'
                                                    }
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                {/* Timeline Mapping Mode Toggle and Controls */}
                                {logic.timelineEvents && logic.timelineEvents.length > 0 && (
                                    <div className="border-b pb-4 mb-6">
                                        <div className="flex items-center justify-between mb-3">
                                            <Button
                                                onClick={() => logic.setTimelineMappingMode(!logic.timelineMappingMode)}
                                                variant={logic.timelineMappingMode ? "default" : "outline"}
                                                className="text-sm"
                                            >
                                                🕒 Timeline Mapping Mode
                                                {logic.timelineMappingMode && <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">ON</span>}
                                            </Button>
                                            
                                            {logic.timelineMappingMode && (
                                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                                    <span>📊 {logic.timelineEvents.length} total events</span>
                                                    <span>✅ {logic.timelineEvents.filter(e => e.is_workflow_related).length} workflow events</span>
                                                    <span>❌ {logic.timelineEvents.filter(e => !e.is_workflow_related).length} unrelated</span>
                                                    <span>⭐ {
                                                        logic.timelineEvents.filter(e => e.is_workflow_related).length > 0 
                                                            ? Math.round(
                                                                logic.timelineEvents
                                                                    .filter(e => e.is_workflow_related && e.confidence_score)
                                                                    .reduce((sum, e) => sum + (e.confidence_score || 0), 0) / 
                                                                logic.timelineEvents.filter(e => e.is_workflow_related && e.confidence_score).length * 100
                                                            ) + '% avg confidence'
                                                            : '0% avg confidence'
                                                    }</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                                
                                {/* Workflow Tabs */}
                                <Tabs value={String(activeWorkflowIndex)} onValueChange={(value) => setActiveWorkflowIndex(Number(value))} className="w-full">
                                    <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${workflows.length}, minmax(0, 1fr))` }}>
                                        {workflows.map((wf, index) => (
                                            <TabsTrigger key={index} value={String(index)} className="group relative">
                                                <span className="truncate">{wf.title || 'Untitled'}</span>
                                                 <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <div className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "absolute top-1/2 right-1 -translate-y-1/2 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity")}>
                                                            <X className="h-3 w-3" />
                                                        </div>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                            <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
                                                            <AlertDialogDescription>
                                                                    Are you sure you want to delete the current workflow &ldquo;{wf.title || 'Untitled'}&rdquo;? This action cannot be undone.
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => logic.handleDeleteWorkflow(wf.id)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>
                                    
                                    {/* Active Workflow Content */}
                                    {logic.activeContent && (
                                        <div className="border rounded-lg p-6 bg-background mt-4">
                                            <div className="mb-6">
                                                <Textarea 
                                                    value={logic.activeContent.title || 'Untitled Workflow'}
                                                    onChange={(e) => logic.handleTitleChange(e.target.value)}
                                                    className="text-2xl font-bold border-0 p-0 h-auto focus-visible:ring-0 resize-none bg-transparent"
                                                />
                                            </div>
                                            
                                            <div className="space-y-8">
                                                {/* Timeline Event Details (when in timeline mode) */}
                                                {logic.timelineMappingMode && logic.timelineEvents?.length > 0 && (
                                                    <div className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
                                                        <h3 className="text-lg font-semibold flex items-center mb-4">
                                                            🕒 Timeline Event Mapping
                                                            <span className="ml-2 text-sm text-muted-foreground">
                                                                ({logic.timelineEvents.filter(e => e.is_workflow_related).length} workflow events)
                                                            </span>
                                                        </h3>
                                                        
                                                        <div className="space-y-3 max-h-60 overflow-y-auto">
                                                            {logic.timelineEvents
                                                                .filter(event => event.is_workflow_related)
                                                                .slice(0, 10) // Show first 10 events
                                                                .map((event, index) => {
                                                                    const firstMapping = event.workflow_mappings?.[0];
                                                                    return (
                                                                        <div key={event.id} className="border rounded p-3 bg-white dark:bg-gray-900/50">
                                                                            <div className="flex items-start justify-between mb-2">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200">
                                                                                        Step {firstMapping?.workflow_step || 'N/A'}
                                                                                    </span>
                                                                                    {event.confidence_score && (
                                                                                        <span className={`text-xs px-2 py-1 rounded ${
                                                                                            event.confidence_score > 0.8 ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' :
                                                                                            event.confidence_score > 0.6 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200' :
                                                                                            'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'
                                                                                        }`}>
                                                                                            {Math.round(event.confidence_score * 100)}% confident
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <span className="text-xs text-muted-foreground">
                                                                                    {new Date(event.timestamp).toLocaleTimeString()}
                                                                                </span>
                                                                            </div>
                                                                            
                                                                            <div className="text-sm mb-2">
                                                                                <strong>Event:</strong> {event.event_type} 
                                                                                {event.payload?.app_name && typeof event.payload.app_name === 'string' ? ` - ${event.payload.app_name}` : ''}
                                                                                {event.payload?.window_name && typeof event.payload.window_name === 'string' ? ` - ${event.payload.window_name}` : ''}
                                                                            </div>
                                                                            
                                                                            {firstMapping?.event_inputs && firstMapping.event_inputs.length > 0 && (
                                                                                <div className="text-xs text-muted-foreground mb-1">
                                                                                    <strong>Inputs:</strong> {firstMapping.event_inputs.join(', ')}
                                                                                </div>
                                                                            )}
                                                                            
                                                                            {firstMapping?.event_outputs && firstMapping.event_outputs.length > 0 && (
                                                                                <div className="text-xs text-muted-foreground mb-1">
                                                                                    <strong>Outputs:</strong> {firstMapping.event_outputs.join(', ')}
                                                                                </div>
                                                                            )}
                                                                            
                                                                            {firstMapping?.business_logics && firstMapping.business_logics.length > 0 && (
                                                                                <div className="text-xs text-blue-600 dark:text-blue-400">
                                                                                    <strong>Logic:</strong> {firstMapping.business_logics[0]}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            
                                                            {logic.timelineEvents.filter(e => e.is_workflow_related).length > 10 && (
                                                                <div className="text-center text-sm text-muted-foreground">
                                                                    ... and {logic.timelineEvents.filter(e => e.is_workflow_related).length - 10} more events
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                                
                                                {/* Inputs */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => logic.toggleSection('inputs')}>
                                                        {logic.collapsedSections.inputs ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Inputs
                                                    </h3>
                                                    {!logic.collapsedSections.inputs && (
                                                        <div className="space-y-2">
                                                            <ul className="list-disc list-outside pl-5 space-y-1">
                                                                {(logic.activeContent.inputs || []).map((item, index) => {
                                                                    const fieldKey = `${activeWorkflowIndex}-inputs`;
                                                                    const itemRef = logic.itemRefs[fieldKey]?.[index];
                                                                    return (
                                                                        <li key={index}>
                                                                            <EditableListItem 
                                                                                item={item} 
                                                                                itemRef={itemRef}
                                                                                onChange={(v) => logic.handleListChange('inputs', index, v)} 
                                                                                onRemove={() => logic.handleRemoveItem('inputs', index)}
                                                                                onEnter={() => logic.handleAddItem('inputs', index)}
                                                                                onBackspaceEmpty={() => logic.handleRemoveItem('inputs', index)}
                                                                            />
                                                                        </li>
                                                                    )
                                                                })}
                                                            </ul>
                                                            <Button variant="ghost" size="sm" onClick={() => logic.handleAddItem('inputs', (logic.activeContent.inputs || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Input
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Outputs */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => logic.toggleSection('outputs')}>
                                                        {logic.collapsedSections.outputs ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Outputs
                                                    </h3>
                                                    {!logic.collapsedSections.outputs && (
                                                        <div className="space-y-2">
                                                            <ul className="list-disc list-outside pl-5 space-y-1">
                                                                {(logic.activeContent.outputs || []).map((item, index) => {
                                                                    const fieldKey = `${activeWorkflowIndex}-outputs`;
                                                                    const itemRef = logic.itemRefs[fieldKey]?.[index];
                                                                    return (
                                                                        <li key={index}>
                                                                            <EditableListItem 
                                                                                item={item} 
                                                                                itemRef={itemRef}
                                                                                onChange={(v) => logic.handleListChange('outputs', index, v)} 
                                                                                onRemove={() => logic.handleRemoveItem('outputs', index)}
                                                                                onEnter={() => logic.handleAddItem('outputs', index)}
                                                                                onBackspaceEmpty={() => logic.handleRemoveItem('outputs', index)}
                                                                            />
                                                                        </li>
                                                                    )
                                                                })}
                                                            </ul>
                                                            <Button variant="ghost" size="sm" onClick={() => logic.handleAddItem('outputs', (logic.activeContent.outputs || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Output
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Steps */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => logic.toggleSection('steps')}>
                                                        {logic.collapsedSections.steps ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Steps
                                                    </h3>
                                                    {!logic.collapsedSections.steps && (
                                                        <div className="space-y-2">
                                                            <ol className="list-decimal list-outside pl-5 space-y-1">
                                                                {(logic.activeContent.steps || []).map((item, index) => {
                                                                    const fieldKey = `${activeWorkflowIndex}-steps`;
                                                                    const itemRef = logic.itemRefs[fieldKey]?.[index];
                                                                    return (
                                                                        <li key={index}>
                                                                            <EditableListItem 
                                                                                item={item} 
                                                                                itemRef={itemRef}
                                                                                onChange={(v) => logic.handleListChange('steps', index, v)} 
                                                                                onRemove={() => logic.handleRemoveItem('steps', index)}
                                                                                onEnter={() => logic.handleAddItem('steps', index)}
                                                                                onBackspaceEmpty={() => logic.handleRemoveItem('steps', index)}
                                                                            />
                                                                        </li>
                                                                    )
                                                                })}
                                                            </ol>
                                                            <Button variant="ghost" size="sm" onClick={() => logic.handleAddItem('steps', (logic.activeContent.steps || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Step
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Business Logic */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => logic.toggleSection('businessLogic')}>
                                                        {logic.collapsedSections.businessLogic ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Business Logic
                                                    </h3>
                                                    {!logic.collapsedSections.businessLogic && (
                                                        <div className="space-y-2">
                                                            <ul className="list-disc list-outside pl-5 space-y-1">
                                                                {(logic.activeContent.businessLogic || []).map((item, index) => {
                                                                    const fieldKey = `${activeWorkflowIndex}-businessLogic`;
                                                                    const itemRef = logic.itemRefs[fieldKey]?.[index];
                                                                    return (
                                                                        <li key={index}>
                                                                            <EditableListItem 
                                                                                item={item} 
                                                                                itemRef={itemRef}
                                                                                onChange={(v) => logic.handleListChange('businessLogic', index, v)} 
                                                                                onRemove={() => logic.handleRemoveItem('businessLogic', index)}
                                                                                onEnter={() => logic.handleAddItem('businessLogic', index)}
                                                                                onBackspaceEmpty={() => logic.handleRemoveItem('businessLogic', index)}
                                                                            />
                                                                        </li>
                                                                    )
                                                                })}
                                                            </ul>
                                                            <Button variant="ghost" size="sm" onClick={() => logic.handleAddItem('businessLogic', (logic.activeContent.businessLogic || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Item
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </Tabs>
                            </div>
                             <div className="absolute bottom-8 right-8">
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button size="lg">Automate</Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>Allow Agent to start the automation (human in the loop stage, each step of agent is confirmed by the user)</p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
} 