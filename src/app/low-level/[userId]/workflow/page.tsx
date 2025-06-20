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
import type { CanvasContent, SynthesizedWorkflow, WorkflowStepAnalysis, CombinedEvent, FinalAnalysisData, SynthesisStep, WorkflowContext, WorkflowBoundary, WorkflowBoundaries, WorkflowDataObject, DatabaseWorkflow, SynthesisSession, Message } from './types';
import { useWorkflowPageLogic } from './useWorkflowPageLogic';
import {
  EditableListItem,
  EditableWorkflowList,
  AiThinkingBubble,
  AnalysisProgressBubble,
  EditableWorkflowBoundaries,
  RawInputView,
  ButtonWithDropdown,
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

const STEP_DEFINITIONS = [
    {
        id: 'define-context',
        number: 1,
        title: 'Analyze Context',
        description: 'AI will analyze events to suggest a starting context.',
    },
    {
        id: 'identify-workflows',
        number: 2,
        title: 'Identify Workflows',
        description: 'Review context, then generate the final workflow list.',
    },
    {
        id: 'define-boundaries',
        number: 3,
        title: 'Define Boundaries',
        description: 'Set triggers and terminators for workflows',
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

    const actionMap: Record<string, { action: () => void; data: object; buttonText: string; } | undefined> = {
        'define-context': {
            action: runInitialAnalysis,
            buttonText: 'Analyze Context',
            data: {
                prompt: "See PROMPT_IDENTIFY_WORKFLOWS, PROMPT_SYNTHESIZE_CONTEXT, and PROMPT_REFINE_WORKFLOWS_AND_CONTEXT in prompts.ts",
                context: {
                    event_count: logic.combinedEvents.length,
                    first_100_events: logic.combinedEvents.slice(0, 100).map(e => e.analysis.step),
                }
            }
        },
        'identify-workflows': {
            action: refineAndIdentifyWorkflows,
            buttonText: 'Identify Workflows',
            data: {
                prompt: "See PROMPT_REFINE_WORKFLOWS_AND_CONTEXT in prompts.ts",
                context: {
                    events: logic.combinedEvents.map(e => e.analysis.step),
                    workflow_context: logic.editableContext,
                    draft_workflow_names: logic.draftWorkflowNames
                }
            }
        },
        'define-boundaries': {
            action: () => processAllWorkflows(identifiedWorkflowNames),
            buttonText: 'Define Boundaries',
            data: {
                 prompt: "See PROMPT_DEFINE_WORKFLOW_BOUNDARIES in prompts.ts",
                 context: {
                    workflows: identifiedWorkflowNames,
                    userContext: logic.editableContext
                },
            }
        },
    };

    const stepState = useMemo(() => {
        const completedStates = {
            'define-context': ['identifying', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'],
            'identify-workflows': ['defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'],
            'define-boundaries': ['done'],
        };

        const enabledStates = {
            'define-context': !isFetchingEvents,
            'identify-workflows': synthesisStep === 'context_editing',
            'define-boundaries': ['workflow_editing', 'defining_boundaries', 'boundaries_editing'].includes(synthesisStep) && identifiedWorkflowNames.length > 0,
        };
        
        const activeStates = {
            'define-context': isAnalyzingEvents,
            'identify-workflows': synthesisStep === 'identifying',
            'define-boundaries': synthesisStep === 'defining_boundaries',
        };

        const showComponentStates = {
            'define-context': ['context_editing', 'identifying', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'identify-workflows': ['workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'define-boundaries': ['boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
        };

        const active = activeStates[id as keyof typeof activeStates] ?? false;
        
        return {
            completed: (completedStates[id as keyof typeof completedStates] || []).includes(synthesisStep),
            active: active,
            enabled: enabledStates[id as keyof typeof enabledStates] ?? false,
            showComponent: showComponentStates[id as keyof typeof showComponentStates] ?? false,
        };
    }, [id, synthesisStep, isFetchingEvents, isAnalyzingEvents, identifiedWorkflowNames]);
    
    const { completed, active, enabled, showComponent } = stepState;
    const stepAction = actionMap[id];
    const [isCollapsed, setIsCollapsed] = useState(true);

    const shouldBeExpanded = 
        (id === 'define-context' && (synthesisStep === 'context_editing' || isAnalyzingEvents)) ||
        (id === 'identify-workflows' && synthesisStep === 'workflow_editing') ||
        (id === 'define-boundaries' && synthesisStep === 'boundaries_editing');
        
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
                        
                        {stepAction && enabled && !completed && (
                           <ButtonWithDropdown
                                onClick={stepAction.action}
                                disabled={isLoading && !active}
                                isLoading={isLoading && active}
                                buttonText={stepAction.buttonText}
                                dropdownContent={
                                    <RawInputView
                                        title={`Raw Input for '${stepAction.buttonText}'`}
                                        data={stepAction.data}
                                    />
                                }
                           />
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
                                    <div className={completed && !active ? 'opacity-60 pointer-events-none' : ''}>
                                        <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-2">
                                            <Label htmlFor="jobRole" className="text-right pt-2">Your Job Role</Label>
                                            <Input id="jobRole" value={logic.editableContext?.user_job_role || ''} onChange={(e) => logic.handleContextChange('user_job_role', e.target.value)} disabled={completed && !active} />
                                            
                                            <Label htmlFor="projectName" className="text-right pt-2">Project Name</Label>
                                            <Input id="projectName" value={logic.editableContext?.project_name || ''} onChange={(e) => logic.handleContextChange('project_name', e.target.value)} disabled={completed && !active} />
                                            
                                            <Label htmlFor="userGoal" className="text-right pt-2">User Goal (from recordings)</Label>
                                            <Textarea id="userGoal" value={logic.editableContext?.user_goal_from_recordings || ''} onChange={(e) => logic.handleContextChange('user_goal_from_recordings', e.target.value)} className="min-h-[60px]" disabled={completed && !active} />
                                            
                                            <Label htmlFor="overallGoal" className="text-right pt-2">Overall Project Goal</Label>
                                            <Textarea id="overallGoal" value={logic.editableContext?.overall_project_goal || ''} onChange={(e) => logic.handleContextChange('overall_project_goal', e.target.value)} className="min-h-[60px]" disabled={completed && !active} />
                                            
                                            <Label htmlFor="overallDesc" className="text-right pt-2">Overall Project Description</Label>
                                            <Textarea id="overallDesc" value={logic.editableContext?.overall_project_description || ''} onChange={(e) => logic.handleContextChange('overall_project_description', e.target.value)} className="min-h-[80px]" disabled={completed && !active} />
                                        </div>
                                    </div>
                                )}
                                
                                {id === 'identify-workflows' && (
                                    <div className={completed ? 'opacity-60 pointer-events-none' : ''}>
                                        <EditableWorkflowList workflows={logic.identifiedWorkflowNames} onWorkflowsChange={logic.setIdentifiedWorkflowNames} />
                                    </div>
                                )}
                                
                                {id === 'define-boundaries' && (
                                    <div className={completed && !active ? 'opacity-60 pointer-events-none' : ''}>
                                        <EditableWorkflowBoundaries boundaries={logic.workflowBoundaries} onBoundariesChange={logic.setWorkflowBoundaries} />
                                        {['boundaries_editing', 'synthesizing'].includes(synthesisStep) && (
                                            <div className="mt-4 flex justify-end">
                                                <Button onClick={() => proceedToSynthesis(workflowBoundaries)} disabled={isLoading}>
                                                    {isLoading ? (
                                                        <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Synthesizing...</>
                                                    ) : (
                                                        'Synthesize Workflows'
                                                    )}
                                                </Button>
                                            </div>
                                        )}
                                    </div>
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

export default function WorkflowPage({ params }: { params: Promise<{ userId:string }> }) {
    const { userId } = use(params);
    const logic: WorkflowPageLogicType = useWorkflowPageLogic(userId);
    const [isStepperCollapsed, setIsStepperCollapsed] = useState(true);
    
    const {
        workflows,
        activeWorkflowIndex,
        setActiveWorkflowIndex,
        messages,
        userInput,
        setUserInput,
        selectedModel,
        setSelectedModel,
        isLoading,
        isAiThinking,
        synthesisStep,
        allWorkflowAnalyses,
        identifiedWorkflowNames,
        setIdentifiedWorkflowNames,
        workflowBoundaries,
        setWorkflowBoundaries,
        combinedEvents,
        collapsedSections,
        workflowContext,
        editableContext,
        isAnalyzingEvents,
        analysisStatus,
        analysisProgress,
        elapsedTime,
        isFetchingEvents,
        activeContent,
        itemRefs,
        toggleSection,
        handleSendMessage,
        handleListChange,
        handleAddItem,
        handleRemoveItem,
        handleTitleChange,
        handleDeleteWorkflow,
        handleContextChange,
        resetConversation,
        deleteAllWorkflows,
        runInitialAnalysis,
        refineAndIdentifyWorkflows,
        processAllWorkflows,
        proceedToSynthesis,
    } = logic;

    useEffect(() => {
        if (synthesisStep !== 'done') {
            setIsStepperCollapsed(false);
        } else {
            setIsStepperCollapsed(true);
        }
    }, [synthesisStep]);

    return (
        <div className="h-full bg-background flex flex-col relative">
            {isFetchingEvents && <LoadingOverlay />}
            {/* New Sticky Header */}
            <div className="sticky top-16 z-20 bg-background/95 backdrop-blur-sm border-b">
                <div className="p-4 flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div 
                            className="flex justify-between items-center cursor-pointer"
                            onClick={() => setIsStepperCollapsed(!isStepperCollapsed)}
                        >
                            <h2 className="text-xl font-semibold">Workflow Setup ({allWorkflowAnalyses.length} steps)</h2>
                            <Button variant="ghost" size="sm">
                                {isStepperCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
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
                </div>
            </div>

            {/* Main Content */}
            <div className="p-6 flex-grow flex flex-col overflow-hidden">
                 <div className="w-full">
                    {!isStepperCollapsed && (
                        <div className="max-w-4xl mx-auto mb-6">
                            <div className="space-y-8">
                                {STEP_DEFINITIONS.map((step, index) => (
                                    <StepperItem 
                                        key={step.id} 
                                        {...step}
                                        isLast={index === STEP_DEFINITIONS.length - 1}
                                        logic={logic}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {synthesisStep === 'done' && workflows.length > 0 && (
                    <div className="pt-4 grid grid-cols-3 gap-6 flex-grow min-h-0">
                    {/* AI Assistant Sidebar */}
                        <aside className="col-span-1 flex flex-col bg-muted/40 border rounded-lg overflow-hidden">
                        <div className="p-4 border-b flex items-center justify-between">
                            <h3 className="text-base font-semibold">AI Assistant</h3>
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
                        <div className="flex flex-col flex-grow p-4 space-y-4 overflow-y-auto bg-muted/30">
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
                                {isAiThinking && <AiThinkingBubble />}
                            </div>
                            
                            {/* Chat Input */}
                            <div className="p-4 border-t">
                                <div className="relative">
                                    <Textarea 
                                        placeholder="Ask AI for help with workflows..." 
                                        className="min-h-[60px] pr-12" 
                                        value={userInput}
                                        onChange={(e) => setUserInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSendMessage())}
                                        disabled={isAiThinking}
                                    />
                                    <Button 
                                        size="sm" 
                                        className="absolute bottom-2 right-2 h-8" 
                                        onClick={handleSendMessage} 
                                        disabled={isAiThinking || !userInput.trim()}
                                    >
                                        <Send className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </aside>

                    {/* Main Canvas Area */}
                        <div className="col-span-2 overflow-y-auto relative">
                        {/* Synthesized Workflows Section */}
                            <div>
                                <div className="flex items-center justify-between mb-6">
                                    <h2 className="text-2xl font-bold">Workflow Canvas</h2>
                                    <div className="text-sm text-muted-foreground">
                                        {workflows.length} workflow{workflows.length !== 1 ? 's' : ''} generated
                                    </div>
                                </div>
                                
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
                                                                <AlertDialogAction onClick={() => handleDeleteWorkflow(wf.id)}>Delete</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>
                                    
                                    {/* Active Workflow Content */}
                                    {activeContent && (
                                        <div className="border rounded-lg p-6 bg-background mt-4">
                                            <div className="mb-6">
                                                <Textarea 
                                                    value={activeContent.title || 'Untitled Workflow'}
                                                    onChange={(e) => handleTitleChange(e.target.value)}
                                                    className="text-2xl font-bold border-0 p-0 h-auto focus-visible:ring-0 resize-none bg-transparent"
                                                />
                                            </div>
                                            
                                            <div className="space-y-8">
                                                {/* Inputs */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => toggleSection('inputs')}>
                                                        {collapsedSections.inputs ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Inputs
                                                    </h3>
                                                    {!collapsedSections.inputs && (
                                                        <div className="space-y-2">
                                                            <ul className="list-disc list-outside pl-5 space-y-1">
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
                                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('inputs', (activeContent.inputs || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Input
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Outputs */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => toggleSection('outputs')}>
                                                        {collapsedSections.outputs ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Outputs
                                                    </h3>
                                                    {!collapsedSections.outputs && (
                                                        <div className="space-y-2">
                                                            <ul className="list-disc list-outside pl-5 space-y-1">
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
                                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('outputs', (activeContent.outputs || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Output
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Steps */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => toggleSection('steps')}>
                                                        {collapsedSections.steps ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Steps
                                                    </h3>
                                                    {!collapsedSections.steps && (
                                                        <div className="space-y-2">
                                                            <ol className="list-decimal list-outside pl-5 space-y-1">
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
                                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('steps', (activeContent.steps || []).length - 1)} className="text-muted-foreground">
                                                                <PlusCircle className="h-4 w-4 mr-2" />Add Step
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Business Logic */}
                                                <div>
                                                    <h3 className="text-lg font-semibold flex items-center cursor-pointer mb-3" onClick={() => toggleSection('businessLogic')}>
                                                        {collapsedSections.businessLogic ? <ChevronRight className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                                                        Business Logic
                                                    </h3>
                                                    {!collapsedSections.businessLogic && (
                                                        <div className="space-y-2">
                                                            <ul className="list-disc list-outside pl-5 space-y-1">
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
                                                            <Button variant="ghost" size="sm" onClick={() => handleAddItem('businessLogic', (activeContent.businessLogic || []).length - 1)} className="text-muted-foreground">
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