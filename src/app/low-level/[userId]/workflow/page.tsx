'use client';
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

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
import type { CanvasContent, SynthesizedWorkflow, WorkflowStepAnalysis, FinalAnalysisData, SynthesisStep, WorkflowContext, WorkflowBoundary, WorkflowBoundaries, WorkflowDataObject, DatabaseWorkflow, SynthesisSession, Message, DetailedSynthesizedWorkflow } from './types';
import { useWorkflowPageLogic } from './useWorkflowPageLogic';
import {
  EditableListItem,
  EditableWorkflowList,
  AiThinkingBubble,
  AnalysisProgressBubble,
  EditableWorkflowBoundaries,
} from './components';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';

// Saved Syntheses Section Component
function SavedSynthesesSection({ userId }: { userId: string }) {
  const [savedSyntheses, setSavedSyntheses] = useState<Array<{
    synthesis_session_id: number;
    display_name: string;
    saved_at: string;
    total_workflows: number;
    workflows: Array<Record<string, unknown>>;
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSyntheses, setShowSyntheses] = useState(false);

  const fetchSavedSyntheses = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/workflows/saved-syntheses?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        setSavedSyntheses(result.data || []);
      }
    } catch (error) {
      console.error('Error fetching saved syntheses:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (showSyntheses) {
      fetchSavedSyntheses();
    }
  }, [showSyntheses, userId]);

  if (savedSyntheses.length === 0 && !showSyntheses) {
    return null; // Don't show the section if no saved syntheses and not expanded
  }

  return (
    <div className="border-t bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Saved Syntheses</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setShowSyntheses(!showSyntheses);
              if (!showSyntheses) {
                fetchSavedSyntheses();
              }
            }}
            className="flex items-center gap-2"
          >
            {showSyntheses ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showSyntheses ? 'Hide' : 'Show'} Saved Syntheses
          </Button>
        </div>

        {showSyntheses && (
          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                <p className="text-gray-600 mt-2">Loading saved syntheses...</p>
              </div>
            ) : savedSyntheses.length === 0 ? (
              <div className="text-center py-8 text-gray-600">
                <p>No saved syntheses found.</p>
                <p className="text-sm">Complete a workflow synthesis and save it to see it here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {savedSyntheses.map((synthesis) => (
                  <Card key={synthesis.synthesis_session_id} className="border-gray-200 hover:shadow-md transition-shadow">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-medium text-gray-900">
                        {synthesis.display_name}
                      </CardTitle>
                      <CardDescription className="text-sm text-gray-600">
                        Saved {new Date(synthesis.saved_at).toLocaleDateString()}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {synthesis.total_workflows} workflow{synthesis.total_workflows !== 1 ? 's' : ''}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-900"
                          onClick={() => {
                            // TODO: Implement view synthesis details
                            console.log('View synthesis:', synthesis.synthesis_session_id);
                          }}
                        >
                          View
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
import { Separator } from '@/components/ui/separator';
import { TimelineAnnotationsTable } from '@/components/TimelineAnnotationsTable';

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
    title: 'Create Timeline Mapping',
    actionText: 'Generate Timeline Map',
    description: 'Analyze and map all low-level events to their corresponding workflow steps for full traceability.',
  },
];

const StepperItem = memo(({
  id, number, title, description, actionText, isLast, logic
}: {
  id: string;
  number: number;
  title: string;
  description: string;
  actionText: string;
  isLast: boolean;
  logic: WorkflowPageLogicType;
}) => {
    const { 
      synthesisStep, isFetchingEvents, isAnalyzingEvents, runInitialAnalysis, isLoading, 
      refineAndIdentifyWorkflows, identifiedWorkflowNames, processAllWorkflows, 
      workflowBoundaries, proceedToSynthesis, generateAndSaveTimelineMapping, workflows,
      isMappingTimeline, timelineAnnotations
    } = logic;

    const actionMap: Record<string, (() => void) | undefined> = {
        'define-context': runInitialAnalysis,
        'select-workflows': refineAndIdentifyWorkflows,
        'define-boundaries': () => processAllWorkflows(identifiedWorkflowNames),
        'timeline-mapping': () => generateAndSaveTimelineMapping(),
    };

    const stepState = useMemo(() => {
        const completedStates: Record<StepId, SynthesisStep[]> = {
  'define-context': ['context_editing', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'],
  'select-workflows': ['defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'],
  'define-boundaries': ['synthesizing', 'done'],
  'synthesize-workflows': ['done'],
          'timeline-mapping': [], // Not implemented yet
};

        const enabledStates = {
            'define-context': !isFetchingEvents,
            'select-workflows': synthesisStep === 'context_editing',
            'define-boundaries': synthesisStep === 'workflow_editing' && identifiedWorkflowNames.length > 0,
            'timeline-mapping': synthesisStep === 'done',
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
                    return synthesisStep === 'done'; // Editable when done with synthesis
                case 'timeline-mapping':
                    return synthesisStep === 'done'; // Editable when done with timeline mapping
                default:
                    return false;
            }
        };

        const showComponentStates = {
            'define-context': ['context_editing', 'identifying', 'workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'select-workflows': ['workflow_editing', 'defining_boundaries', 'boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'define-boundaries': ['boundaries_editing', 'synthesizing', 'done'].includes(synthesisStep),
            'synthesize-workflows': synthesisStep === 'done',
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
    }, [id, synthesisStep, isFetchingEvents, isAnalyzingEvents, identifiedWorkflowNames, isMappingTimeline, timelineAnnotations]);
    
    const { completed, active, editable, enabled, showComponent } = stepState;
    const action = actionMap[id];
    const [isCollapsed, setIsCollapsed] = useState(true);

    const shouldBeExpanded = 
        (id === 'define-context' && (synthesisStep === 'context_editing' || isAnalyzingEvents)) ||
        (id === 'select-workflows' && synthesisStep === 'workflow_editing') ||
        (id === 'define-boundaries' && synthesisStep === 'boundaries_editing') ||
        (id === 'synthesize-workflows' && synthesisStep === 'synthesizing') ||
        (id === 'timeline-mapping' && synthesisStep === 'done');



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
                    completed ? 'bg-black text-white border-black' : active ? 'bg-white text-black border-black' : enabled ? 'bg-white text-black border-black' : 'bg-gray-50 text-gray-400 border-black'
                }`}>
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
                                    <><RefreshCw className="mr-2 h-5 w-5 animate-spin" strokeWidth={2} />Processing...</>
                                ) : (
                                    actionText
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
                        ) : id === 'timeline-mapping' && isMappingTimeline ? (
                            <AnalysisProgressBubble status={logic.timelineMappingStatus} progress={logic.timelineMappingProgress} elapsedTime={logic.timelineMappingElapsedTime} />
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
                                
                                {id === 'synthesize-workflows' && showComponent && (
                                    <div className="pt-4 flex-grow w-full">
                                      <div className="space-y-4">
                                        <Accordion type="multiple" defaultValue={["human-friendly"]} className="w-full">
                                          <AccordionItem value="human-friendly">
                                            <AccordionTrigger className="text-lg font-semibold">
                                              Synthesized Workflows (Human-Friendly View)
                                            </AccordionTrigger>
                                            <AccordionContent>
                                              <div className="max-h-[600px] overflow-auto">
                                                <WorkflowFormattedView workflows={logic.workflows} />
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
                                )}
                                {id === 'timeline-mapping' && showComponent && (
                                    <div className="w-full">
                                      {timelineAnnotations ? (
                                        <TimelineAnnotationsTable annotations={timelineAnnotations as any} />
                                      ) : (
                                        <div className="text-center text-muted-foreground p-4 border rounded-lg bg-muted/50">
                                          Click the button above to generate and view the timeline mapping data.
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

const Stepper = ({ logic }: { logic: WorkflowPageLogicType }) => {
  const { synthesisStep, isFetchingEvents } = logic;

  // Show stats above the stepper when not fetching events
  const showStatsCard = !isFetchingEvents;

  return (
    <div className="w-full">
      {/* Stats Card - shown when in idle state */}
      {showStatsCard && (
        <div className="w-full p-8 text-center mb-6">
          <Card>
            <CardContent>
              {/* Date Range - will be added back when available from backend stats */}
              
              {logic.userStats && (
                  <div className="mb-4 text-left">
                      <h3 className="text-lg font-semibold mb-2">User Stats</h3>
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
                  <div className="text-center text-muted-foreground">
                    <p>Data will be loaded when workflow analysis is triggered</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Always show the stepper */}
      <div className="max-w-4xl mx-auto py-6">
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
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default function WorkflowPage({ params }: { params: Promise<{ userId:string }> }) {
    const { userId } = use(params);
    const logic: WorkflowPageLogicType = useWorkflowPageLogic(userId);

    return (
        <div className="h-full bg-background flex flex-col relative">
            {/* Header */}
            <div className="border-b bg-muted/40 p-4">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="w-64">
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
                        
                        {/* Save Synthesis Button */}
                        {logic.workflows && logic.workflows.length > 0 && logic.synthesisStep === 'done' && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button 
                                            variant="default" 
                                            size="sm"
                                            onClick={async () => {
                                                const result = await logic.saveSynthesis();
                                                if (result.success) {
                                                    // Could add toast notification here
                                                    console.log('Synthesis saved successfully');
                                                }
                                            }}
                                            className="flex items-center gap-2 bg-black text-white hover:bg-gray-800"
                                        >
                                            <PlusCircle className="h-4 w-4" />
                                            Save Synthesis
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        <p>Save this completed synthesis for future reference</p>
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                        
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
            </div>
            
            {/* Saved Syntheses Section */}
            <SavedSynthesesSection userId={userId} />
        </div>
    );
} 