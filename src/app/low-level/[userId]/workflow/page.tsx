'use client';
/* eslint-disable @typescript-eslint/no-unused-vars */

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
} from "@/components/ui/alert-dialog";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, ChevronRight, ChevronUp, RefreshCw, RotateCcw, Trash2, Zap } from "lucide-react";
import { memo, use, useEffect, useMemo, useState } from 'react';
import {
  AnalysisProgressBubble,
  EditableSynthesizedWorkflows,
  EditableWorkflowBoundaries,
  EditableWorkflowList
} from './components';
import type { CanvasContent, SynthesisStep } from './types';
import { useWorkflowPageLogic } from './useWorkflowPageLogic';

import { FilteredStatsDisplay } from '@/components/FilteredStatsDisplay';
import { SavedSynthesesSection } from '@/components/SavedSynthesesSection';
import { TimeBoundarySelector } from '@/components/TimeBoundarySelector';
import { WorkflowExportDropdown } from '@/components/WorkflowExportDropdown';
import { EditableTimelineMappings } from '@/components/low-level/EditableTimelineMappings';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// Human-friendly workflow formatter component
const WorkflowFormattedView = ({ workflows }: { workflows: CanvasContent[] }) => {
  if (!workflows || workflows.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-8">
        <p>No synthesized workflows available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {workflows.map((workflow, index) => (
        <Card key={index} className="w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="outline">Workflow {index + 1}</Badge>
              {workflow.title || 'Untitled Workflow'}
            </CardTitle>
            {workflow.description && (
              <p className="text-sm text-muted-foreground">{workflow.description}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Workflow Types */}
            {workflow.workflow_types && workflow.workflow_types.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Workflow Types</h4>
                <div className="space-y-2">
                  {workflow.workflow_types.map((type, typeIndex) => (
                    <div key={typeIndex} className="border rounded p-3">
                      <div className="font-medium">{type.type_name}</div>
                      {type.type_description && (
                        <div className="text-sm text-muted-foreground mt-1">{type.type_description}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workflow Instances */}
            {workflow.workflow_instances && workflow.workflow_instances.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Workflow Instances</h4>
                <div className="flex flex-wrap gap-2">
                  {workflow.workflow_instances.map((instance, instanceIndex) => (
                    <Badge key={instanceIndex} variant="secondary">
                      {instance.instance_name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}



            {/* Steps */}
            {workflow.steps && workflow.steps.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Workflow Steps</h4>
                <div className="space-y-3">
                  {workflow.steps.map((step, stepIndex) => (
                    <div key={stepIndex} className="border rounded p-3">
                      <div className="font-medium flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">Step {stepIndex + 1}</Badge>
                        {step.step_name}
                      </div>
                      
                      {/* Substeps */}
                      {step.substeps && step.substeps.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <div className="text-sm font-medium text-muted-foreground">Substeps:</div>
                          {step.substeps.map((substep, substepIndex) => (
                            <div key={substepIndex} className="ml-4 p-2 bg-muted/50 rounded text-sm">
                              <div className="font-medium">{substep.substep_name}</div>
                              
                              {/* Substep Inputs */}
                              {substep.inputs && substep.inputs.length > 0 && (
                                <div className="mt-1">
                                  <span className="text-xs font-medium text-muted-foreground">Inputs: </span>
                                  <span className="text-xs">{substep.inputs.join(', ')}</span>
                                </div>
                              )}
                              
                              {/* Substep Outputs */}
                              {substep.outputs && substep.outputs.length > 0 && (
                                <div className="mt-1">
                                  <span className="text-xs font-medium text-muted-foreground">Outputs: </span>
                                  <span className="text-xs">{substep.outputs.join(', ')}</span>
                                </div>
                              )}
                              
                              {/* Business Logic */}
                              {substep.business_logic && substep.business_logic.length > 0 && (
                                <div className="mt-1">
                                  <span className="text-xs font-medium text-muted-foreground">Logic: </span>
                                  <span className="text-xs">{substep.business_logic.join('; ')}</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />
            
            {/* Metadata */}
            <div className="text-xs text-muted-foreground space-y-1">
              {workflow.id && <div>ID: {workflow.id}</div>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

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
  actionText: string;
  description: string;
};

type StepId = 'define-context' | 'select-workflows' | 'define-boundaries' | 'synthesize-workflows' | 'timeline-mapping';

const STEP_DEFINITIONS: StepDefinition[] = [
  {
    id: 'define-context',
    title: 'Analyze Context & Draft Workflows',
    actionText: 'Analyze Context',
    description: 'Understand the user\'s environment and goals, then draft initial workflow names.',
  },
  {
    id: 'select-workflows',
    title: 'Select & Refine Workflows',
    actionText: 'Select & Refine',
    description: 'Choose the workflows to proceed with and refine their names.',
  },
  {
    id: 'define-boundaries',
    title: 'Define Workflow Boundaries',
    actionText: 'Define Boundaries',
    description: 'Review and adjust the start and end points for each identified workflow.',
  },
  {
    id: 'synthesize-workflows',
    title: 'Review & Edit Synthesized Workflows',
    actionText: '', // No button for this step, it's a display area
    description: 'Review the fully synthesized workflows, including types, instances, steps, and substeps.',
  },
  {
    id: 'timeline-mapping',
    title: 'Create Timeline Annotations',
    actionText: 'Generate Timeline Annotations',
    description: 'Analyze and annotate all low-level events to their corresponding workflow steps for full traceability.',
  },
];

const StepperItemComponent = ({
  id, number, title, description, actionText, isLast, logic, saveStatus, setSaveStatus, setRefreshTrigger, userId
}: {
  id: string;
  number: number;
  title: string;
  description: string;
  actionText: string;
  isLast: boolean;
  logic: ReturnType<typeof useWorkflowPageLogic>;
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  setSaveStatus: (status: 'idle' | 'saving' | 'success' | 'error') => void;
  setRefreshTrigger: (fn: (prev: number) => number) => void;
  userId: string;
}) => {
    const { 
      synthesisStep, isFetchingEvents, isAnalyzingEvents, runInitialAnalysis, isLoading, 
      refineAndIdentifyWorkflows, workflowNames, processAllWorkflows, 
      workflowBoundaries, proceedToSynthesis, generateAndSaveTimelineMapping, workflows,
      isMappingTimeline, timelineAnnotations, timeBoundary
    } = logic;

    const actionMap: Record<string, (() => void) | undefined> = {
        'define-context': runInitialAnalysis,
        'select-workflows': refineAndIdentifyWorkflows,
        'define-boundaries': () => processAllWorkflows(workflowNames),
        'timeline-mapping': () => generateAndSaveTimelineMapping(),
    };

    const stepState = useMemo(() => {
        const completedStates: Record<StepId, SynthesisStep[]> = {
  'define-context': ['identifying', 'context_editing', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'synthesis_complete', 'done', 'timeline_complete'],
  'select-workflows': ['defining_boundaries', 'boundaries_editing', 'synthesizing', 'synthesis_complete', 'done', 'timeline_complete'],
  'define-boundaries': ['synthesizing', 'synthesis_complete', 'done', 'timeline_complete'],
  'synthesize-workflows': ['synthesis_complete', 'done', 'timeline_complete'],
          'timeline-mapping': ['timeline_complete'],
};

        const enabledStates = {
            'define-context': Boolean(!isFetchingEvents && timeBoundary.startDate && timeBoundary.endDate && ['idle'].includes(synthesisStep)),
            'select-workflows': synthesisStep === 'context_editing' && timeBoundary.startDate && timeBoundary.endDate,
            'define-boundaries': synthesisStep === 'workflow_editing' && workflowNames.length > 0 && timeBoundary.startDate && timeBoundary.endDate,
            'timeline-mapping': synthesisStep === 'synthesis_complete' || synthesisStep === 'done',
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
                case 'timeline-mapping':
                    return isMappingTimeline;
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
                case 'synthesize-workflows':
                    return synthesisStep === 'synthesis_complete' && !isMappingTimeline; // Editable when synthesis complete AND not mapping timeline
                case 'timeline-mapping':
                    return synthesisStep === 'done' || synthesisStep === 'timeline_complete'; // Editable during and after completion
                default:
                    return false;
            }
        };

        const showComponentStates = {
            'define-context': ['context_editing', 'identifying', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'synthesis_complete', 'done', 'timeline_complete'].includes(synthesisStep),
            'select-workflows': ['workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'synthesis_complete', 'done', 'timeline_complete'].includes(synthesisStep),
            'define-boundaries': ['boundaries_editing', 'synthesizing', 'synthesis_complete', 'done', 'timeline_complete'].includes(synthesisStep),
            'synthesize-workflows': ['synthesis_complete', 'done', 'timeline_complete'].includes(synthesisStep),
            'timeline-mapping': timelineAnnotations !== null,
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
    }, [id, synthesisStep, isFetchingEvents, isAnalyzingEvents, workflowNames, isMappingTimeline, timelineAnnotations, timeBoundary]);
    
    const { completed, active, editable, enabled, showComponent } = stepState;
    const action = actionMap[id];
    
    // Storage key for step expansion state persistence
    const STEP_STORAGE_KEY = useMemo(() => `workflow-step-expansion-${userId}-${id}`, [userId, id]);
    
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try {
            const stored = localStorage.getItem(STEP_STORAGE_KEY);
            return stored !== null ? JSON.parse(stored) : true;
        } catch {
            return true;
        }
    });

    // Track if user has manually controlled this step
    const [manuallyControlled, setManuallyControlled] = useState(false);

    // Smart auto-expansion - only if user hasn't manually controlled
    useEffect(() => {
        const shouldAutoExpand = 
            (id === 'synthesize-workflows' && synthesisStep === 'synthesis_complete') ||
            (id === 'timeline-mapping' && timelineAnnotations !== null);
        
        // Only auto-expand if user hasn't manually controlled AND should expand
        if (shouldAutoExpand && !manuallyControlled && isCollapsed) {
            setIsCollapsed(false);
            localStorage.setItem(STEP_STORAGE_KEY, JSON.stringify(false));
        }
    }, [synthesisStep, timelineAnnotations, manuallyControlled, isCollapsed, STEP_STORAGE_KEY, id]);

    return (
        <div className="relative">{/* Fixed parsing issue */}
            {!isLast && <div className="absolute left-6 top-12 -bottom-4 w-0.5 bg-gray-300"></div>}
            
            <div className="flex items-start gap-4">
                <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold transition-all duration-200 border-2 ${completed ? 'bg-black text-white border-black' : active ? 'bg-white text-black border-black' : enabled ? 'bg-white text-black border-black' : 'bg-gray-50 text-gray-400 border-black'}`}>
                    {active ? <RefreshCw className="h-6 w-6 animate-spin" strokeWidth={2} /> : number}
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-lg font-semibold">{title}</h3>
                            <p className="text-sm text-muted-foreground">{description}</p>
                        </div>
                        
                        {action && enabled && !completed && actionText && (
                            <Button onClick={action} disabled={isLoading} className="ml-4">
                                {isLoading && active ? (
                                    <span><RefreshCw className="mr-2 h-5 w-5 animate-spin" strokeWidth={2} />Processing...</span>
                                ) : (
                                    actionText
                                )}
                            </Button>
                        )}
                        
                        {(showComponent || (completed && !active)) && (
                            <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => {
                                    const newCollapsed = !isCollapsed;
                                    setIsCollapsed(newCollapsed);
                                    setManuallyControlled(true); // Mark as user-controlled
                                    localStorage.setItem(STEP_STORAGE_KEY, JSON.stringify(newCollapsed));
                                }} 
                                className="ml-2 border-black hover:bg-gray-100 px-3 py-2 flex items-center gap-2"
                            >
                                <span className="text-xs font-medium">
                                    {isCollapsed ? 'Show' : 'Hide'}
                                </span>
                                {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                            </Button>
                        )}
                    </div>
                    
                    {!isCollapsed && (
                      <div className="mt-4">
                        {id === 'define-context' && isAnalyzingEvents ? (
                                                          <AnalysisProgressBubble status={logic.analysisStatus} progress={logic.analysisProgress} elapsedTime={logic.elapsedTime} batchInfo={null} />
                        ) : id === 'timeline-mapping' && isMappingTimeline ? (
                            <AnalysisProgressBubble status={logic.timelineMappingStatus} progress={logic.timelineMappingProgress} elapsedTime={logic.timelineMappingElapsedTime} batchInfo={logic.timelineMappingBatch} />
                        ) : showComponent ? (
                            <div className="p-4 border border-black rounded-lg bg-muted/50">
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
                                        <EditableWorkflowList workflows={logic.workflowNames} onWorkflowsChange={logic.setWorkflowNames} />
                                    </div>
                                )}
                                
                                {id === 'define-boundaries' && (
                                    <div className={completed && !editable ? 'opacity-60 pointer-events-none' : ''}>
                                        <EditableWorkflowBoundaries boundaries={logic.workflowBoundaries} onBoundariesChange={logic.setWorkflowBoundaries} />
                                        {['boundaries_editing', 'synthesizing'].includes(synthesisStep) && (
                                            <CardFooter className="flex justify-between mt-6">
                                              <Button onClick={logic.goBackToWorkflowEditing} disabled={logic.isLoading || logic.synthesisStep !== 'boundaries_editing'}>Back</Button>
                                              <Button 
                                                onClick={logic.confirmBoundaries} 
                                                disabled={logic.isLoading || logic.synthesisStep !== 'boundaries_editing' || !logic.timeBoundary.startDate || !logic.timeBoundary.endDate}
                                                title={!logic.timeBoundary.startDate || !logic.timeBoundary.endDate ? 'Please select a timeframe before synthesizing workflows' : undefined}
                                              >
                                                {logic.synthesisStep === 'synthesizing' ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Synthesizing...</> : 'Confirm Boundaries & Synthesize'}
                                              </Button>
                                            </CardFooter>
                                        )}
                                    </div>
                                )}
                                
                                {id === 'synthesize-workflows' && showComponent && (
                                    <div className={completed && !editable ? 'opacity-60 pointer-events-none' : ''}>
                                      <div className="pt-4 flex-grow w-full">
                                        <div className="space-y-4">
                                          <Accordion type="multiple" defaultValue={["human-friendly"]} className="w-full">
                                            <AccordionItem value="human-friendly">
                                              <AccordionTrigger className="text-lg font-semibold">
                                                Synthesized Workflows (Human-Friendly View)
                                              </AccordionTrigger>
                                              <AccordionContent>
                                                <div className="max-h-[600px] overflow-auto">
                                                  <EditableSynthesizedWorkflows 
                                                    workflows={logic.workflows} 
                                                    onWorkflowsChange={logic.handleWorkflowsChange} 
                                                  />
                                                </div>
                                              </AccordionContent>
                                            </AccordionItem>
                                            
                                            <AccordionItem value="raw-json">
                                              <AccordionTrigger className="text-lg font-semibold">
                                                Raw JSON Data
                                              </AccordionTrigger>
                                              <AccordionContent>
                                                <pre className="text-xs whitespace-pre-wrap max-h-[600px] overflow-auto bg-background p-4 rounded border">
                                                  {JSON.stringify(logic.workflows, null, 2)}
                                                </pre>
                                              </AccordionContent>
                                            </AccordionItem>
                                          </Accordion>
                                        </div>
                                      </div>
                                    </div>
                                )}
                                {id === 'timeline-mapping' && showComponent && (
                                    <div className={completed && !editable ? 'opacity-60 pointer-events-none' : ''}>
                                      <div className="pt-4 flex-grow w-full">
                                        <div className="space-y-4">
                                          <div className="w-full">
                                            <h3 className="text-lg font-semibold mb-4">Timeline Event Annotations</h3>
                                            <div className="max-h-[800px] overflow-auto">
                                              {(timelineAnnotations !== null || logic.isMappingTimeline) ? (
                                                <div className="space-y-4">
                                                  {/* Show processing indicator when mapping is active and no results yet */}
                                                  {logic.isMappingTimeline && (!timelineAnnotations || timelineAnnotations.length === 0) && (
                                                    <div className="p-4 border border-black rounded-lg bg-yellow-50">
                                                      <div className="flex items-center space-x-2">
                                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black"></div>
                                                        <span className="text-sm">
                                                          {logic.timelineMappingBatch 
                                                            ? logic.timelineMappingBatch.mode === 'parallel'
                                                              ? `Processing ${logic.timelineMappingBatch.total} batches in parallel... ${logic.timelineMappingBatch.current} completed`
                                                              : `Processing batch ${logic.timelineMappingBatch.current} of ${logic.timelineMappingBatch.total}... Results will appear as they're generated`
                                                            : 'Processing timeline events... Results will appear as they\'re generated'
                                                          }
                                                        </span>
                                                      </div>
                                                      {logic.timelineMappingBatch && (
                                                        <div className="mt-2">
                                                          <div className="w-full bg-gray-200 rounded-full h-2">
                                                            <div 
                                                              className="bg-black h-2 rounded-full transition-all duration-300" 
                                                              style={{ width: `${(logic.timelineMappingBatch.current / logic.timelineMappingBatch.total) * 100}%` }}
                                                            ></div>
                                                          </div>
                                                          <div className="text-xs text-gray-600 mt-1">
                                                            {logic.timelineMappingBatch.mode === 'parallel'
                                                              ? `${logic.timelineMappingBatch.current}/${logic.timelineMappingBatch.total} batches completed`
                                                              : `${Math.round((logic.timelineMappingBatch.current / logic.timelineMappingBatch.total) * 100)}% complete`
                                                            }
                                                          </div>
                                                        </div>
                                                      )}

                                                      {/* Batch Status List */}
                                                      {logic.batchList.length > 0 && (
                                                        <div className="mt-4 p-3 border border-black rounded-lg">
                                                          <div className="text-sm font-medium mb-2">Batch Status:</div>
                                                          <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
                                                            {logic.batchList.map(batch => (
                                                              <div key={batch.id} className="flex justify-between items-center py-1">
                                                                <span className="flex-1">Batch {batch.id}</span>
                                                                <span className="flex-1 text-center">{batch.status}</span>
                                                                <div className="flex-1 text-right text-xs">
                                                                  {batch.eventCount !== undefined && `${batch.eventCount} events`}
                                                                  {batch.mappingCount !== undefined && ` → ${batch.mappingCount} mapped`}
                                                                  {batch.processingTime && ` (${batch.processingTime}ms)`}
                                                                </div>
                                                              </div>
                                                            ))}
                                                          </div>
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}
                                                  
                                                  <EditableTimelineMappings
                                                    annotations={timelineAnnotations || []}
                                                    workflows={logic.workflows}
                                                    onAnnotationsChange={logic.handleTimelineAnnotationsChange}
                                                    isProcessing={logic.isMappingTimeline}
                                                    processingBatch={logic.timelineMappingBatch}
                                                  />
                                                </div>
                                              ) : (
                                                <div className="text-center text-muted-foreground p-4 border border-black rounded-lg bg-muted/50">
                                                  Click the button above to generate and view the timeline annotation data.
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                                                                    
                        </div>
                      </div>
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
};
StepperItemComponent.displayName = 'StepperItem';
const StepperItem = memo(StepperItemComponent);

const Stepper = ({ logic, userId, saveStatus, setSaveStatus, setRefreshTrigger }: { 
  logic: ReturnType<typeof useWorkflowPageLogic>; 
  userId: string;
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  setSaveStatus: (status: 'idle' | 'saving' | 'success' | 'error') => void;
  setRefreshTrigger: (fn: (prev: number) => number) => void;
}) => {
  const { synthesisStep, isFetchingEvents } = logic;

  // Show stats above the stepper when not fetching events
  const showStatsCard = !isFetchingEvents;

  return (
    <div className="w-full mx-auto">
      {/* Stats Card - shown when in idle state */}
      {showStatsCard && (
        <div className="mb-6">
              {/* Time Boundary Selection */}
              <div className="mb-6">
                <div className="mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Timeframe Selection <span className="text-red-500">*</span>
                    <span className="text-xs text-gray-500 ml-2">(Required for timeline annotations)</span>
                  </label>
                </div>
                <TimeBoundarySelector
                  selectedBoundary={logic.timeBoundary}
                  onBoundaryChange={logic.setTimeBoundary}
                  onClear={logic.clearTimeBoundary}
                  disabled={logic.isLoading}
                  userId={userId}
                  required={true}
                />
              </div>
              
              {/* Filtered Data Stats */}
              <div className="mb-6">
                <FilteredStatsDisplay 
                  userId={userId}
                  timeBoundary={logic.timeBoundary}
                />
              </div>
              
              {/* All-Time User Stats */}
              {logic.userStats && (
                  <div className="mb-4 text-left">
                      <h3 className="text-lg font-semibold mb-2">All-Time User Stats</h3>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                          <div className="bg-white border border-black p-3 rounded-lg">
                              <p className="text-muted-foreground">Total Events</p>
                              <p className="font-bold text-2xl">{logic.userStats.totalEvents}</p>
                          </div>
                          <div className="bg-white border border-black p-3 rounded-lg">
                              <p className="text-muted-foreground">Timeline Steps Processed</p>
                              <p className="font-bold text-2xl">{logic.userStats.stepsProcessed} / {logic.userStats.totalSteps}</p>
                          </div>
                          <div className="bg-white border border-black p-3 rounded-lg">
                              <p className="text-muted-foreground">LLM Labeled / Human Annotated</p>
                              <p className="font-bold text-2xl">{logic.userStats.labelingTotal} / {logic.userStats.llmGeneratedLabeled}</p>
                          </div>
                      </div>
                  </div>
              )}
        </div>
      )}

      {/* Always show the stepper */}
      <div className="w-full mx-auto py-6">
        <div className="space-y-8">
          {STEP_DEFINITIONS.map((step, index) => (
            <StepperItem
              key={step.id}
              id={step.id}
              number={index + 1}
              title={step.title}
              description={step.description}
              actionText={step.actionText}
              isLast={index === STEP_DEFINITIONS.length - 1}
              logic={logic}
              saveStatus={saveStatus}
              setSaveStatus={setSaveStatus}
              setRefreshTrigger={setRefreshTrigger}
              userId={userId}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default function WorkflowPage({ params }: { params: Promise<{ userId:string }> }) {
    const { userId } = use(params);
    const logic = useWorkflowPageLogic(userId);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [mainWorkflowOpen, setMainWorkflowOpen] = useState(true);





    return (
        <div className="h-full bg-background flex flex-col relative">
            {/* Orchestration Progress Modal */}
            <AlertDialog open={logic.isOrchestrating}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>5-Step Workflow Orchestration</AlertDialogTitle>
                        <AlertDialogDescription>
                            Running automated workflow synthesis with all 5 steps in sequence.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="py-8">
                        <AnalysisProgressBubble 
                            status={logic.orchestrationStatus} 
                            progress={logic.orchestrationProgress} 
                            elapsedTime={logic.orchestrationElapsedTime}
                            batchInfo={null} 
                        />
                    </div>
                </AlertDialogContent>
            </AlertDialog>

            {/* Header */}
            <div className="border-b bg-muted/40 p-4">
                <div className="max-w-6xl mx-auto flex items-center gap-4">
                    <div className="w-64 flex-shrink-0">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full">
                                    {logic.selectedModel}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuRadioGroup
                                    value={logic.selectedModel}
                                    onValueChange={logic.setSelectedModel}
                                >
                                    <DropdownMenuRadioItem value="gemini-2.5-flash">gemini-2.5-flash</DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="gemini-2.5-pro">gemini-2.5-pro</DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                    <h1 className="text-2xl font-bold flex-grow text-center">Workflow Synthesis</h1>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={logic.runFullProcess}
                                        disabled={logic.isOrchestrating}
                                        className="flex items-center gap-2"
                                    >
                                        {logic.isOrchestrating ? (
                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Zap className="h-4 w-4" />
                                        )}
                                        Run All 5 Steps
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Automatically run all 5 workflow synthesis steps in sequence.</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>

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
            <div className="w-full max-w-6xl mx-auto p-8 space-y-6">
                {/* Setup Instructions - Always Visible */}
                <Card className="w-full border-black">
                    <CardHeader>
                        <h3 className="text-lg font-semibold">Setup Instructions</h3>
                        <p className="text-sm text-muted-foreground">
                            Provide any additional context, requirements, or specific instructions for workflow synthesis (optional)
                        </p>
                    </CardHeader>
                    <CardContent>
                        <Textarea 
                            value={logic.editableContext?.user_instructions || ''} 
                            onChange={(e) => logic.handleContextChange('user_instructions', e.target.value)} 
                            className="min-h-[120px]" 
                            placeholder="Examples:&#10;• Focus on compliance and validation steps&#10;• This is for agent training - emphasize required checks&#10;• Include customer interaction points&#10;• Highlight data validation requirements&#10;• Note any specific business rules or exceptions"
                            disabled={logic.isLoading}
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardContent>
                        <Collapsible open={mainWorkflowOpen} onOpenChange={setMainWorkflowOpen}>
                            <div className="mb-4 text-left">
                                <CollapsibleTrigger className="w-full flex items-center justify-between p-4 rounded-lg border border-black border-dashed bg-white hover:bg-gray-50 transition-colors duration-200 cursor-pointer group">
                                    <h3 className="text-lg font-semibold">Workflow Synthesis</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                                            {mainWorkflowOpen ? 'Collapse' : 'Expand'}
                                        </span>
                                        {mainWorkflowOpen ? <ChevronDown className="h-5 w-5 text-black" /> : <ChevronRight className="h-5 w-5 text-black" />}
                                    </div>
                                </CollapsibleTrigger>
                                
                                <CollapsibleContent className={cn(
                                    "transition-all duration-300 ease-in-out w-full",
                                    mainWorkflowOpen ? "max-h-[5000px] opacity-100" : "max-h-0 opacity-50 overflow-hidden"
                                )}>
                                    <div className="mt-4">
                                        <Stepper 
                                          logic={logic} 
                                          userId={userId} 
                                          saveStatus={saveStatus} 
                                          setSaveStatus={setSaveStatus} 
                                          setRefreshTrigger={setRefreshTrigger} 
                                        />
                                    </div>
                                </CollapsibleContent>
                            </div>
                        </Collapsible>
                    </CardContent>
                </Card>
                
                {/* Save Synthesis & Export Buttons - Always visible when workflow is complete */}
                {logic.workflows && logic.workflows.length > 0 && (logic.synthesisStep === 'done' || logic.synthesisStep === 'timeline_complete') && logic.timelineAnnotations && (
                  <Card>
                    <CardContent>
                      <div className="flex justify-center gap-4 py-4">
                        <Button 
                          variant="default" 
                          size="lg"
                          disabled={saveStatus === 'saving'}
                          onClick={async () => {
                            setSaveStatus('saving');
                            const result = await logic.saveSynthesis();
                            if (result.success) {
                              setSaveStatus('success');
                              setRefreshTrigger(prev => prev + 1);
                              setTimeout(() => setSaveStatus('idle'), 2000);
                            } else {
                              setSaveStatus('error');
                              setTimeout(() => setSaveStatus('idle'), 3000);
                            }
                          }}
                          className="flex items-center gap-2 bg-black text-white hover:bg-gray-800"
                        >
                          {saveStatus === 'saving' && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>}
                          {saveStatus === 'success' && <div className="text-green-400">✓</div>}
                          {saveStatus === 'error' && <div className="text-red-400">✗</div>}
                          Save Complete Synthesis
                        </Button>
                        
                        <WorkflowExportDropdown 
                          workflows={logic.workflows.map(w => ({
                            id: w.id,
                            title: w.title,
                            created_at: new Date().toISOString() // Use current date as fallback
                          }))} 
                          userId={userId}
                          disabled={saveStatus === 'saving'}
                        />
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Saved Syntheses Section */}
                <SavedSynthesesSection userId={userId} refreshTrigger={refreshTrigger} />
            </div>
        </div>
    );
} 