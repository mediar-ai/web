import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface SavedSynthesis {
  id: number;
  title: string;
  description?: string;
  processData: {
    context: Record<string, unknown>;
    identifiedWorkflows: string[];
    boundaries: Record<string, unknown>;
    conversation: Array<{ id: string; sender: string; text: string }>;
    results: Array<Record<string, unknown>>;
    fullProcessData: Record<string, unknown>;
  };
  workflowIds: number[];
  modelsUsed: string[];
  totalTokensUsed: number;
  synthesisDuration?: number;
  version: string;
  synthesisStartedAt?: string;
  synthesisCompletedAt?: string;
  createdAt: string;
}

interface SavedSynthesesSectionProps {
  userId: string;
}

export function SavedSynthesesSection({ userId }: SavedSynthesesSectionProps) {
  const [savedSyntheses, setSavedSyntheses] = useState<SavedSynthesis[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSynthesis, setSelectedSynthesis] = useState<SavedSynthesis | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (userId) {
      fetchSavedSyntheses();
    }
  }, [userId]);

  const fetchSavedSyntheses = async () => {
    try {
      const response = await fetch(`/api/workflows/saved-syntheses?userId=${userId}`);
      if (response.ok) {
        const result = await response.json();
        setSavedSyntheses(result.data || []);
      } else {
        console.error('Failed to fetch saved syntheses');
      }
    } catch (error) {
      console.error('Error fetching saved syntheses:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return 'Unknown';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  // Helper function to format workflow results to match live synthesis structure
  const formatWorkflowResults = (results: Array<Record<string, unknown>>) => {
    return results.map((workflow, index) => {
      const workflowData = workflow.detailed_workflow_data as Record<string, unknown> || workflow;
      return {
        id: (workflow.id as number) || index + 131, // Use workflow ID or generate one
        title: (workflow.title as string) || `Workflow ${index + 1}`,
        description: (workflowData.description as string) || 'No description available',
        workflow_types: (workflowData.workflow_types as Array<Record<string, unknown>>) || [],
        workflow_instances: (workflowData.workflow_instances as Array<Record<string, unknown>>) || [],
        steps: (workflowData.steps as Array<Record<string, unknown>>) || []
      };
    });
  };

  // Helper function to format workflow boundaries
  const formatWorkflowBoundaries = (boundaries: Record<string, unknown>) => {
    return Object.entries(boundaries).map(([workflowName, boundaryData]) => {
      const boundary = boundaryData as Record<string, unknown>;
      return {
        workflow_name: workflowName,
        trigger: boundary.trigger as string || 'Not defined',
        terminator: boundary.terminator as string || 'Not defined'
      };
    });
  };

  if (loading) {
    return (
      <div className="w-full p-8 text-center mb-6">
        <Card>
          <CardContent>
            <div className="mb-4 text-left">
              <h3 className="text-lg font-semibold mb-2">Saved Workflow Syntheses</h3>
              <div className="text-center py-8 text-gray-600">Loading saved syntheses...</div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (savedSyntheses.length === 0) {
    return null; // Don't show section if no saved syntheses
  }

  return (
    <div className="w-full p-8 text-center mb-6">
      <Card>
        <CardContent>
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <div className="mb-4 text-left">
              <CollapsibleTrigger className="w-full flex items-center justify-between hover:bg-gray-50 p-2 rounded">
                <h3 className="text-lg font-semibold">Saved Workflow Syntheses ({savedSyntheses.length})</h3>
                <span className="text-sm font-mono">{isOpen ? '▼' : '▶'}</span>
              </CollapsibleTrigger>
              
              <CollapsibleContent>
                <div className="mt-4">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 gap-4 p-4 bg-white border-b border-black text-sm font-medium text-black">
                    <div className="col-span-4">Title</div>
                    <div className="col-span-2">Created</div>
                    <div className="col-span-2">Workflows</div>
                    <div className="col-span-2">Duration</div>
                    <div className="col-span-2">Model</div>
                  </div>
                  
                  {/* Table Rows */}
                  {savedSyntheses.map((synthesis) => (
                    <div
                      key={synthesis.id}
                      onClick={() => setSelectedSynthesis(synthesis)}
                      className={`grid grid-cols-12 gap-4 p-4 cursor-pointer transition-colors hover:bg-gray-100 border-b border-gray-300 ${
                        selectedSynthesis?.id === synthesis.id 
                          ? 'bg-gray-200 border-black' 
                          : ''
                      }`}
                    >
                      <div className="col-span-4">
                        <div className="font-semibold text-black">{synthesis.title}</div>
                        {synthesis.description && (
                          <div className="text-sm text-gray-600 mt-1">{synthesis.description}</div>
                        )}
                      </div>
                      <div className="col-span-2 text-sm text-gray-700">
                        {formatDate(synthesis.createdAt)}
                      </div>
                      <div className="col-span-2 text-sm text-gray-700">
                        <div>{synthesis.workflowIds.length} workflows</div>
                        <div className="text-xs text-gray-600">{synthesis.processData.identifiedWorkflows.length} identified</div>
                      </div>
                      <div className="col-span-2 text-sm text-gray-700">
                        {formatDuration(synthesis.synthesisDuration)}
                      </div>
                      <div className="col-span-2 text-xs text-black">
                        <div>{synthesis.version}</div>
                        {synthesis.modelsUsed.map(model => (
                          <div key={model} className="text-gray-600">
                            {model.split('-')[0]}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Selected Synthesis Details - Replicate Live Synthesis Structure */}
                  {selectedSynthesis && (
                    <div className="mt-6 max-w-4xl mx-auto py-6">
                      <h4 className="text-2xl font-bold text-center mb-8">
                        {selectedSynthesis.title}
                      </h4>
                      
                      <div className="space-y-8">
                        {/* Step 1: Analyze Context & Draft Workflows */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 p-4 border-b flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-medium text-sm">
                              <span className="text-xs font-mono">✓</span>
                            </div>
                            <div className="flex-grow">
                              <h3 className="text-lg font-semibold">1. Analyze Context & Draft Workflows</h3>
                                                             <p className="text-sm text-muted-foreground">
                                 Understand the user&apos;s environment and goals, then draft initial workflow names.
                               </p>
                            </div>
                          </div>
                          
                          <div className="p-4 border rounded-lg bg-muted/50">
                            <div className="grid grid-cols-[auto_1fr] items-start gap-x-4 gap-y-4">
                              <Label className="text-right pt-2 font-medium">Your Job Role</Label>
                              <div className="p-2 bg-white border rounded text-sm">
                                {(selectedSynthesis.processData.context.user_job_role as string) || 'Not specified'}
                              </div>
                              
                              <Label className="text-right pt-2 font-medium">Project Name</Label>
                              <div className="p-2 bg-white border rounded text-sm">
                                {(selectedSynthesis.processData.context.project_name as string) || 'Not specified'}
                              </div>
                              
                              <Label className="text-right pt-2 font-medium">User Goal (from recordings)</Label>
                              <div className="p-2 bg-white border rounded text-sm min-h-[60px]">
                                {(selectedSynthesis.processData.context.user_goal_from_recordings as string) || 'Not specified'}
                              </div>
                              
                              <Label className="text-right pt-2 font-medium">Overall Project Goal</Label>
                              <div className="p-2 bg-white border rounded text-sm min-h-[60px]">
                                {(selectedSynthesis.processData.context.overall_project_goal as string) || 'Not specified'}
                              </div>
                              
                              <Label className="text-right pt-2 font-medium">Overall Project Description</Label>
                              <div className="p-2 bg-white border rounded text-sm min-h-[80px]">
                                {(selectedSynthesis.processData.context.overall_project_description as string) || 'Not specified'}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Step 2: Select & Refine Workflows */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 p-4 border-b flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-medium text-sm">
                              <span className="text-xs font-mono">✓</span>
                            </div>
                            <div className="flex-grow">
                              <h3 className="text-lg font-semibold">2. Select & Refine Workflows</h3>
                              <p className="text-sm text-muted-foreground">
                                Choose the workflows to proceed with and refine their names.
                              </p>
                            </div>
                          </div>
                          
                          <div className="p-4 border rounded-lg bg-muted/50">
                            <div className="text-sm font-medium mb-3">Edit workflow names below:</div>
                            <div className="space-y-2">
                              {selectedSynthesis.processData.identifiedWorkflows.map((workflow, index) => (
                                <div key={index} className="flex items-center gap-3">
                                  <div className="font-medium text-sm">{index + 1}.</div>
                                  <div className="flex-grow p-2 bg-white border rounded text-sm">
                                    {workflow}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Step 3: Define Workflow Boundaries */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 p-4 border-b flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-medium text-sm">
                              <span className="text-xs font-mono">✓</span>
                            </div>
                            <div className="flex-grow">
                              <h3 className="text-lg font-semibold">3. Define Workflow Boundaries</h3>
                              <p className="text-sm text-muted-foreground">
                                Review and adjust the start and end points for each identified workflow.
                              </p>
                            </div>
                          </div>
                          
                          <div className="p-4 border rounded-lg bg-muted/50">
                            <div className="text-sm font-medium mb-3">Review and edit workflow boundaries below:</div>
                            <div className="space-y-4">
                              {formatWorkflowBoundaries(selectedSynthesis.processData.boundaries).map((boundary, index) => (
                                <div key={index} className="border border-gray-300 rounded p-4 bg-white">
                                  <h4 className="font-semibold text-black mb-3">{boundary.workflow_name}</h4>
                                  <div className="space-y-2">
                                    <div>
                                      <strong>Start Point:</strong>
                                      <div className="mt-1 p-2 bg-gray-50 rounded text-sm">
                                        {boundary.trigger}
                                      </div>
                                    </div>
                                    <div>
                                      <strong>End Point:</strong>
                                      <div className="mt-1 p-2 bg-gray-50 rounded text-sm">
                                        {boundary.terminator}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Step 4: Review & Edit Synthesized Workflows */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 p-4 border-b flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-medium text-sm">
                              <span className="text-xs font-mono">✓</span>
                            </div>
                            <div className="flex-grow">
                              <h3 className="text-lg font-semibold">4. Review & Edit Synthesized Workflows</h3>
                              <p className="text-sm text-muted-foreground">
                                Review the fully synthesized workflows, including types, instances, steps, and substeps.
                              </p>
                            </div>
                          </div>
                          
                          <div className="p-4 border rounded-lg bg-muted/50">
                            <div className="space-y-4">
                              <Accordion type="multiple" defaultValue={["human-friendly"]} className="w-full">
                                <AccordionItem value="human-friendly">
                                  <AccordionTrigger className="text-lg font-semibold">
                                    Synthesized Workflows (Human-Friendly View)
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <div className="max-h-[600px] overflow-auto">
                                      <div className="space-y-6">
                                        {formatWorkflowResults(selectedSynthesis.processData.results).map((workflow, workflowIndex) => (
                                          <Card key={workflowIndex} className="w-full">
                                            <CardContent className="p-6">
                                              <div className="space-y-6">
                                                {/* Header */}
                                                <div className="flex flex-col gap-2">
                                                  <div className="flex items-center gap-3">
                                                    <Badge variant="outline">Workflow {workflowIndex + 1}</Badge>
                                                    <h3 className="text-xl font-bold">{workflow.title}</h3>
                                                  </div>
                                                  <p className="text-muted-foreground">{workflow.description}</p>
                                                </div>

                                                {/* Workflow Types */}
                                                {workflow.workflow_types && workflow.workflow_types.length > 0 && (
                                                  <div>
                                                    <h4 className="font-semibold text-sm mb-2">Workflow Types</h4>
                                                    <div className="space-y-2">
                                                      {workflow.workflow_types.map((type: Record<string, unknown>, typeIndex: number) => (
                                                        <div key={typeIndex} className="border rounded p-3 bg-muted/50">
                                                          <div className="font-medium">{type.type_name as string}</div>
                                                          <div className="text-sm text-muted-foreground mt-1">
                                                            {type.type_description as string}
                                                          </div>
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
                                                      {workflow.workflow_instances.map((instance: Record<string, unknown>, instanceIndex: number) => (
                                                        <Badge key={instanceIndex} variant="secondary">
                                                          {instance.instance_name as string}
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
                                                      {workflow.steps.map((step: Record<string, unknown>, stepIndex: number) => (
                                                        <div key={stepIndex} className="border rounded p-3">
                                                          <div className="font-medium flex items-center gap-2">
                                                            <Badge variant="outline" className="text-xs">Step {stepIndex + 1}</Badge>
                                                            {step.step_name as string}
                                                          </div>
                                                          
                                                          {/* Substeps */}
                                                          {Array.isArray(step.substeps) && step.substeps.length > 0 && (
                                                            <div className="mt-3 space-y-2">
                                                              <div className="text-sm font-medium text-muted-foreground">Substeps:</div>
                                                              {step.substeps.map((substep: Record<string, unknown>, substepIndex: number) => (
                                                                <div key={substepIndex} className="ml-4 p-2 bg-muted/50 rounded text-sm">
                                                                  <div className="font-medium">{substep.substep_name as string}</div>
                                                                  
                                                                  {/* Substep Inputs */}
                                                                  {Array.isArray(substep.inputs) && substep.inputs.length > 0 && (
                                                                    <div className="mt-1">
                                                                      <span className="text-xs font-medium text-muted-foreground">Inputs: </span>
                                                                      <span className="text-xs">{substep.inputs.join(', ')}</span>
                                                                    </div>
                                                                  )}
                                                                  
                                                                  {/* Substep Outputs */}
                                                                  {Array.isArray(substep.outputs) && substep.outputs.length > 0 && (
                                                                    <div className="mt-1">
                                                                      <span className="text-xs font-medium text-muted-foreground">Outputs: </span>
                                                                      <span className="text-xs">{substep.outputs.join(', ')}</span>
                                                                    </div>
                                                                  )}
                                                                  
                                                                  {/* Business Logic */}
                                                                  {Array.isArray(substep.business_logic) && substep.business_logic.length > 0 && (
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

                                                {/* Metadata */}
                                                <div className="text-xs text-muted-foreground space-y-1 border-t pt-4">
                                                  <div>ID: {workflow.id || 'N/A'}</div>
                                                </div>
                                              </div>
                                            </CardContent>
                                          </Card>
                                        ))}
                                      </div>
                                    </div>
                                  </AccordionContent>
                                </AccordionItem>
                                
                                <AccordionItem value="raw-json">
                                  <AccordionTrigger className="text-lg font-semibold">
                                    Raw JSON Data
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    <pre className="text-xs whitespace-pre-wrap max-h-[600px] overflow-auto bg-background p-4 rounded border">
                                      {JSON.stringify(selectedSynthesis.processData.results, null, 2)}
                                    </pre>
                                  </AccordionContent>
                                </AccordionItem>
                              </Accordion>
                            </div>
                          </div>
                        </div>

                        {/* Step 5: Create Timeline Mapping */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-muted/40 p-4 border-b flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center font-medium text-sm">
                              <span className="text-xs font-mono">✓</span>
                            </div>
                            <div className="flex-grow">
                              <h3 className="text-lg font-semibold">5. Create Timeline Mapping</h3>
                              <p className="text-sm text-muted-foreground">
                                Analyze and map all low-level events to their corresponding workflow steps for full traceability.
                              </p>
                            </div>
                          </div>
                          
                          <div className="p-4 border rounded-lg bg-muted/50">
                            <div className="w-full">
                              <div className="text-center text-muted-foreground p-4 border rounded-lg bg-muted/50">
                                <div className="space-y-2">
                                  <p className="font-medium">Timeline Mapping Completed</p>
                                  <div className="text-sm">
                                    <div><strong>Workflows Mapped:</strong> {selectedSynthesis.workflowIds.length} workflows processed</div>
                                    <div><strong>Models Used:</strong> {selectedSynthesis.modelsUsed.join(', ')}</div>
                                    <div><strong>Total Tokens:</strong> {selectedSynthesis.totalTokensUsed.toLocaleString()}</div>
                                    <div><strong>Messages in Process:</strong> {selectedSynthesis.processData.conversation.length} synthesis messages</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
} 