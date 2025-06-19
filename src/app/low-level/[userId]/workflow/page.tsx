'use client';
/* eslint-disable @typescript-eslint/no-unused-vars */

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
import type { CanvasContent, SynthesizedWorkflow, WorkflowStepAnalysis, CombinedEvent, FinalAnalysisData, SynthesisStep, WorkflowContext, WorkflowBoundary, WorkflowBoundaries, WorkflowDataObject, DatabaseWorkflow, SynthesisSession, Message } from './types';
import { useWorkflowPageLogic } from './useWorkflowPageLogic';
import {
  EditableListItem,
  EditableWorkflowList,
  AiThinkingBubble,
  AnalysisProgressBubble,
  EditableWorkflowBoundaries,
} from './components';

// Refactored components and shared types now live in dedicated files. They are
// imported where needed in other modules. To avoid duplicate identifier
// conflicts inside this file (which still contains the original definitions),
// we do NOT import them here.

export default function WorkflowPage({ params }: { params: Promise<{ userId: string }> }) {
    const { userId } = use(params);
    const logic = useWorkflowPageLogic(userId);
    
    const {
        view,
        setView,
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
        fullscreenChatRef,
        sidebarChatRef,
        activeContent,
        itemRefs,
        toggleSection,
        scrollToBottom,
        startWorkflowIdentification,
        processAllWorkflows,
        proceedToSynthesis,
        handleSendMessage,
        handleListChange,
        handleAddItem,
        handleRemoveItem,
        handleTitleChange,
        handleDeleteWorkflow,
        handleContextChange,
        resetConversation,
        deleteAllWorkflows,
    } = logic;

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