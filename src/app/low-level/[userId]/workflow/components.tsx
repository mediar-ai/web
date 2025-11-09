'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import React from 'react';

import { Edit2, Edit3, PlusCircle, RefreshCw, Trash2, X } from 'lucide-react';

import { CanvasContent, WorkflowBoundaries } from './types';

// ----------------------------------------------------------------------------------
// EditableListItem
// ----------------------------------------------------------------------------------
export const EditableListItem = ({
  item,
  onChange,
  onRemove,
  onEnter,
  onBackspaceEmpty,
  itemRef,
}: {
  item: string;
  onChange: (value: string) => void;
  onRemove: () => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  itemRef: React.RefObject<HTMLTextAreaElement | null>;
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
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100"
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
};

// ----------------------------------------------------------------------------------
// EditableWorkflowList
// ----------------------------------------------------------------------------------
interface EditableWorkflowListProps {
  workflows: string[];
  onWorkflowsChange: (workflows: string[]) => void;
}

export const EditableWorkflowList: React.FC<EditableWorkflowListProps> = ({
  workflows,
  onWorkflowsChange,
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
      <div className="flex justify-start items-center pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleAddWorkflow}
          className="flex items-center gap-2"
        >
          <PlusCircle className="h-4 w-4" />
          Add Workflow
        </Button>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------------
// AiThinkingBubble
// ----------------------------------------------------------------------------------
export const AiThinkingBubble = () => (
  <div className="flex items-start gap-3">
    <div className="p-3 rounded-lg bg-background border">
      <div className="flex items-center gap-2">
        <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.3s]" />
        <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.15s]" />
        <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" />
      </div>
    </div>
  </div>
);

// ----------------------------------------------------------------------------------
// AnalysisProgressBubble
// ----------------------------------------------------------------------------------
export const AnalysisProgressBubble = ({
  status,
  progress: _progress, // Passed from parent but progress bar UI removed
  elapsedTime,
  batchInfo: _batchInfo, // Passed from parent but batch info UI removed
}: {
  status: string;
  progress: number;
  elapsedTime: number;
  batchInfo?: { current: number; total: number } | null;
}) => (
  <div className="flex items-start gap-3 w-full">
    <div className="p-4 rounded-lg bg-background border w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-5 w-5 text-primary animate-spin" />
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">{status}</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>Elapsed time: {elapsedTime.toFixed(1)}s</span>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ----------------------------------------------------------------------------------
// EditableWorkflowBoundaries
// ----------------------------------------------------------------------------------
export const EditableWorkflowBoundaries = ({
  boundaries,
  onBoundariesChange,
}: {
  boundaries: WorkflowBoundaries;
  onBoundariesChange: (boundaries: WorkflowBoundaries) => void;
}) => {
  // Maintain a local copy so typing does not trigger a full re-render that steals focus
  const [localBoundaries, setLocalBoundaries] = React.useState<WorkflowBoundaries>(boundaries);

  // Keep local state in sync when parent updates (e.g. after auto-fill from backend)
  React.useEffect(() => {
    setLocalBoundaries(boundaries);
  }, [boundaries]);

  // Debounce updates to parent to avoid excessive renders
  const debounceRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleBoundaryChange = (
    workflowName: string,
    field: 'trigger' | 'terminator',
    value: string,
  ) => {
    const updated = {
      ...localBoundaries,
      [workflowName]: {
        ...localBoundaries[workflowName],
        [field]: value,
      },
    } as WorkflowBoundaries;

    setLocalBoundaries(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onBoundariesChange(updated);
    }, 300);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <Edit2 className="h-4 w-4" />
        <span>Review and edit workflow boundaries below:</span>
      </div>

      <div className="space-y-6">
        { }
        {Object.entries(boundaries).map(([workflowName, _]) => (
          <Card key={workflowName} className="p-4">
            <h4 className="font-medium mb-3">{workflowName}</h4>
            <div className="space-y-3">
              <div>
                <Label
                  htmlFor={`trigger-${workflowName}`}
                  className="text-sm font-medium"
                >
                  Trigger (How this workflow starts)
                </Label>
                <Textarea
                  id={`trigger-${workflowName}`}
                  value={localBoundaries[workflowName]?.trigger || ''}
                  onChange={(e) =>
                    handleBoundaryChange(workflowName, 'trigger', e.target.value)
                  }
                  className="mt-1"
                  rows={2}
                />
              </div>
              <div>
                <Label
                  htmlFor={`terminator-${workflowName}`}
                  className="text-sm font-medium"
                >
                  Terminator (How this workflow ends)
                </Label>
                <Textarea
                  id={`terminator-${workflowName}`}
                  value={localBoundaries[workflowName]?.terminator || ''}
                  onChange={(e) =>
                    handleBoundaryChange(workflowName, 'terminator', e.target.value)
                  }
                  className="mt-1"
                  rows={2}
                />
              </div>
            </div>
          </Card>
        ))}
      </div>


    </div>
  );
};

// ----------------------------------------------------------------------------------
// EditableSynthesizedWorkflows
// ----------------------------------------------------------------------------------
export const EditableSynthesizedWorkflows = ({
  workflows,
  onWorkflowsChange,
}: {
  workflows: CanvasContent[];
  onWorkflowsChange: (workflows: CanvasContent[]) => void;
}) => {
  // Maintain a local copy so typing does not trigger a full re-render that steals focus
  const [localWorkflows, setLocalWorkflows] = React.useState<CanvasContent[]>(workflows);

  // Keep local state in sync when parent updates
  React.useEffect(() => {
    setLocalWorkflows(workflows);
  }, [workflows]);

  // Debounce updates to parent to avoid excessive renders
  const debounceRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleWorkflowChange = (
    workflowIndex: number,
    field: keyof CanvasContent,
    value: string
  ) => {
    const updated = [...localWorkflows];
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      [field]: value,
    };

    setLocalWorkflows(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onWorkflowsChange(updated);
    }, 300);
  };

  const handleWorkflowTypeChange = (
    workflowIndex: number,
    typeIndex: number,
    field: 'type_name' | 'type_description',
    value: string
  ) => {
    const updated = [...localWorkflows];
    const updatedTypes = [...(updated[workflowIndex].workflow_types || [])];
    updatedTypes[typeIndex] = {
      ...updatedTypes[typeIndex],
      [field]: value,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      workflow_types: updatedTypes,
    };

    setLocalWorkflows(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onWorkflowsChange(updated);
    }, 300);
  };

  const handleWorkflowInstanceChange = (
    workflowIndex: number,
    instanceIndex: number,
    field: 'name' | 'description' | 'instance_name',
    value: string
  ) => {
    const updated = [...localWorkflows];
    const updatedInstances = [...(updated[workflowIndex].workflow_instances || [])];
    updatedInstances[instanceIndex] = {
      ...updatedInstances[instanceIndex],
      [field]: value,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      workflow_instances: updatedInstances,
    };

    setLocalWorkflows(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onWorkflowsChange(updated);
    }, 300);
  };

  const handleStepChange = (
    workflowIndex: number,
    stepIndex: number,
    field: 'title' | 'description' | 'step_name',
    value: string
  ) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      [field]: value,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };

    setLocalWorkflows(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onWorkflowsChange(updated);
    }, 300);
  };

  const handleSubstepChange = (
    workflowIndex: number,
    stepIndex: number,
    substepIndex: number,
    field: 'substep_name',
    value: string
  ) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    const updatedSubsteps = [...(updatedSteps[stepIndex].substeps || [])];
    updatedSubsteps[substepIndex] = {
      ...updatedSubsteps[substepIndex],
      [field]: value,
    };
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      substeps: updatedSubsteps,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };

    setLocalWorkflows(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onWorkflowsChange(updated);
    }, 300);
  };

  const handleArrayFieldChange = (
    workflowIndex: number,
    stepIndex: number,
    substepIndex: number,
    field: 'inputs' | 'outputs' | 'business_logic',
    arrayIndex: number,
    value: string
  ) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    const updatedSubsteps = [...(updatedSteps[stepIndex].substeps || [])];
    const updatedArray = [...(updatedSubsteps[substepIndex][field] || [])];
    updatedArray[arrayIndex] = value;
    updatedSubsteps[substepIndex] = {
      ...updatedSubsteps[substepIndex],
      [field]: updatedArray,
    };
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      substeps: updatedSubsteps,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };

    setLocalWorkflows(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onWorkflowsChange(updated);
    }, 300);
  };

  // Add/Remove functions for workflow types
  const addWorkflowType = (workflowIndex: number) => {
    const updated = [...localWorkflows];
    const newType = { name: '', description: '', type_name: '', type_description: '', conditions: {} };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      workflow_types: [...(updated[workflowIndex].workflow_types || []), newType],
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  const removeWorkflowType = (workflowIndex: number, typeIndex: number) => {
    const updated = [...localWorkflows];
    const updatedTypes = [...(updated[workflowIndex].workflow_types || [])];
    updatedTypes.splice(typeIndex, 1);
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      workflow_types: updatedTypes,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  // Add/Remove functions for workflow instances
  const addWorkflowInstance = (workflowIndex: number) => {
    const updated = [...localWorkflows];
    const newInstance = { name: '', description: '', instance_name: '', instance_data: {} };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      workflow_instances: [...(updated[workflowIndex].workflow_instances || []), newInstance],
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  const removeWorkflowInstance = (workflowIndex: number, instanceIndex: number) => {
    const updated = [...localWorkflows];
    const updatedInstances = [...(updated[workflowIndex].workflow_instances || [])];
    updatedInstances.splice(instanceIndex, 1);
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      workflow_instances: updatedInstances,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  // Add/Remove functions for steps
  const addStep = (workflowIndex: number) => {
    const updated = [...localWorkflows];
    const newStep = { title: '', description: '', step_name: '', substeps: [] };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: [...(updated[workflowIndex].steps || []), newStep],
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  const removeStep = (workflowIndex: number, stepIndex: number) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    updatedSteps.splice(stepIndex, 1);
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  // Add/Remove functions for substeps
  const addSubstep = (workflowIndex: number, stepIndex: number) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    const newSubstep = { substep_name: '', inputs: [], outputs: [], business_logic: [] };
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      substeps: [...(updatedSteps[stepIndex].substeps || []), newSubstep],
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  const removeSubstep = (workflowIndex: number, stepIndex: number, substepIndex: number) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    const updatedSubsteps = [...(updatedSteps[stepIndex].substeps || [])];
    updatedSubsteps.splice(substepIndex, 1);
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      substeps: updatedSubsteps,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  // Add/Remove functions for array fields (inputs, outputs, business_logic)
  const addArrayItem = (
    workflowIndex: number,
    stepIndex: number,
    substepIndex: number,
    field: 'inputs' | 'outputs' | 'business_logic'
  ) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    const updatedSubsteps = [...(updatedSteps[stepIndex].substeps || [])];
    const updatedArray = [...(updatedSubsteps[substepIndex][field] || [])];
    updatedArray.push('');
    updatedSubsteps[substepIndex] = {
      ...updatedSubsteps[substepIndex],
      [field]: updatedArray,
    };
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      substeps: updatedSubsteps,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  const removeArrayItem = (
    workflowIndex: number,
    stepIndex: number,
    substepIndex: number,
    field: 'inputs' | 'outputs' | 'business_logic',
    arrayIndex: number
  ) => {
    const updated = [...localWorkflows];
    const updatedSteps = [...(updated[workflowIndex].steps || [])];
    const updatedSubsteps = [...(updatedSteps[stepIndex].substeps || [])];
    const updatedArray = [...(updatedSubsteps[substepIndex][field] || [])];
    updatedArray.splice(arrayIndex, 1);
    updatedSubsteps[substepIndex] = {
      ...updatedSubsteps[substepIndex],
      [field]: updatedArray,
    };
    updatedSteps[stepIndex] = {
      ...updatedSteps[stepIndex],
      substeps: updatedSubsteps,
    };
    updated[workflowIndex] = {
      ...updated[workflowIndex],
      steps: updatedSteps,
    };
    setLocalWorkflows(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onWorkflowsChange(updated), 300);
  };

  if (!localWorkflows || localWorkflows.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-8">
        <p>No synthesized workflows available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
        <Edit2 className="h-4 w-4" />
        <span>Review and edit synthesized workflows below:</span>
      </div>

      <div className="space-y-6">
        {localWorkflows.map((workflow, workflowIndex) => (
          <Card key={workflow.id || workflowIndex} className="w-full">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline">Workflow {workflowIndex + 1}</Badge>
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor={`title-${workflowIndex}`} className="text-sm font-medium">
                    Title
                  </Label>
                  <Input
                    id={`title-${workflowIndex}`}
                    value={workflow.title || ''}
                    onChange={(e) => handleWorkflowChange(workflowIndex, 'title', e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`description-${workflowIndex}`} className="text-sm font-medium">
                    Description
                  </Label>
                  <Textarea
                    id={`description-${workflowIndex}`}
                    value={workflow.description || ''}
                    onChange={(e) => handleWorkflowChange(workflowIndex, 'description', e.target.value)}
                    className="mt-1"
                    rows={2}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Workflow Types */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm">Workflow Types</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addWorkflowType(workflowIndex)}
                    className="h-8 px-2"
                  >
                    <PlusCircle className="h-3 w-3 mr-1" />
                    Add Type
                  </Button>
                </div>
                {workflow.workflow_types && workflow.workflow_types.length > 0 && (
                  <div className="space-y-3">
                    {workflow.workflow_types.map((type, typeIndex) => (
                      <div key={typeIndex} className="border rounded p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Type {typeIndex + 1}</Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeWorkflowType(workflowIndex, typeIndex)}
                            className="h-6 w-6 p-0"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <Label className="text-xs font-medium">Type Name</Label>
                          <Input
                            value={type.type_name || ''}
                            onChange={(e) => handleWorkflowTypeChange(workflowIndex, typeIndex, 'type_name', e.target.value)}
                            className="mt-1 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium">Type Description</Label>
                          <Textarea
                            value={type.type_description || ''}
                            onChange={(e) => handleWorkflowTypeChange(workflowIndex, typeIndex, 'type_description', e.target.value)}
                            className="mt-1 text-sm"
                            rows={2}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Workflow Instances */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm">Workflow Instances</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addWorkflowInstance(workflowIndex)}
                    className="h-8 px-2"
                  >
                    <PlusCircle className="h-3 w-3 mr-1" />
                    Add Instance
                  </Button>
                </div>
                {workflow.workflow_instances && workflow.workflow_instances.length > 0 && (
                  <div className="space-y-2">
                    {workflow.workflow_instances.map((instance, instanceIndex) => (
                      <div key={instanceIndex} className="border rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-xs font-medium">Instance {instanceIndex + 1}</Label>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeWorkflowInstance(workflowIndex, instanceIndex)}
                            className="h-6 w-6 p-0"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <div>
                          <Label className="text-xs font-medium">Instance Name</Label>
                          <Input
                            value={instance.instance_name || ''}
                            onChange={(e) => handleWorkflowInstanceChange(workflowIndex, instanceIndex, 'instance_name', e.target.value)}
                            className="mt-1 text-sm"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Steps */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm">Workflow Steps</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addStep(workflowIndex)}
                    className="h-8 px-2"
                  >
                    <PlusCircle className="h-3 w-3 mr-1" />
                    Add Step
                  </Button>
                </div>
                {workflow.steps && workflow.steps.length > 0 && (
                  <Accordion type="multiple" className="w-full space-y-2">
                    {workflow.steps.map((step, stepIndex) => (
                      <AccordionItem key={stepIndex} value={`step-${stepIndex}`} className="border rounded">
                        <div className="px-3 py-2 space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium text-muted-foreground">Step {stepIndex + 1} Name</Label>
                            <div className="flex items-center gap-1">
                              <AccordionTrigger className="flex items-center gap-2 px-3 py-1 border border-black rounded hover:bg-gray-50 text-xs font-medium">
                                <span>Details</span>
                              </AccordionTrigger>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeStep(workflowIndex, stepIndex);
                                }}
                                className="h-6 w-6 p-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <Input
                            value={step.step_name || ''}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleStepChange(workflowIndex, stepIndex, 'step_name', e.target.value);
                            }}
                            className="text-sm w-full min-w-[300px]"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <AccordionContent className="px-3 pb-3">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h5 className="font-medium text-xs text-muted-foreground">Substeps</h5>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => addSubstep(workflowIndex, stepIndex)}
                                className="h-6 px-2"
                              >
                                <PlusCircle className="h-3 w-3 mr-1" />
                                Add Substep
                              </Button>
                            </div>
                            {step.substeps && step.substeps.length > 0 && (
                              step.substeps.map((substep, substepIndex) => (
                                <div key={substepIndex} className="border rounded p-3 space-y-3 bg-muted/20">
                                  <div className="flex items-center justify-between">
                                    <Label className="text-xs font-medium">Substep {substepIndex + 1}</Label>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => removeSubstep(workflowIndex, stepIndex, substepIndex)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <div>
                                    <Label className="text-xs font-medium">Substep Name</Label>
                                    <Input
                                      value={substep.substep_name || ''}
                                      onChange={(e) => handleSubstepChange(workflowIndex, stepIndex, substepIndex, 'substep_name', e.target.value)}
                                      className="mt-1 text-sm w-full min-w-[300px]"
                                    />
                                  </div>
                                  
                                  {/* Inputs */}
                                  <div>
                                    <div className="flex items-center justify-between">
                                      <Label className="text-xs font-medium">Inputs</Label>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addArrayItem(workflowIndex, stepIndex, substepIndex, 'inputs')}
                                        className="h-5 px-1"
                                      >
                                        <PlusCircle className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div className="space-y-2 mt-1">
                                      {(substep.inputs || []).map((input, inputIndex) => (
                                        <div key={inputIndex} className="flex items-start gap-2">
                                          <Textarea
                                            value={input || ''}
                                            onChange={(e) => handleArrayFieldChange(workflowIndex, stepIndex, substepIndex, 'inputs', inputIndex, e.target.value)}
                                            className="text-xs flex-1 min-w-0 resize-none"
                                            rows={2}
                                          />
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => removeArrayItem(workflowIndex, stepIndex, substepIndex, 'inputs', inputIndex)}
                                            className="h-7 w-7 p-0 flex-shrink-0"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Outputs */}
                                  <div>
                                    <div className="flex items-center justify-between">
                                      <Label className="text-xs font-medium">Outputs</Label>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addArrayItem(workflowIndex, stepIndex, substepIndex, 'outputs')}
                                        className="h-5 px-1"
                                      >
                                        <PlusCircle className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div className="space-y-2 mt-1">
                                      {(substep.outputs || []).map((output, outputIndex) => (
                                        <div key={outputIndex} className="flex items-start gap-2">
                                          <Textarea
                                            value={output || ''}
                                            onChange={(e) => handleArrayFieldChange(workflowIndex, stepIndex, substepIndex, 'outputs', outputIndex, e.target.value)}
                                            className="text-xs flex-1 min-w-0 resize-none"
                                            rows={2}
                                          />
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => removeArrayItem(workflowIndex, stepIndex, substepIndex, 'outputs', outputIndex)}
                                            className="h-7 w-7 p-0 flex-shrink-0"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Business Logic */}
                                  <div>
                                    <div className="flex items-center justify-between">
                                      <Label className="text-xs font-medium">Business Logic</Label>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => addArrayItem(workflowIndex, stepIndex, substepIndex, 'business_logic')}
                                        className="h-5 px-1"
                                      >
                                        <PlusCircle className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div className="space-y-2 mt-1">
                                      {(substep.business_logic || []).map((logic, logicIndex) => (
                                        <div key={logicIndex} className="flex items-start gap-2">
                                          <Textarea
                                            value={logic || ''}
                                            onChange={(e) => handleArrayFieldChange(workflowIndex, stepIndex, substepIndex, 'business_logic', logicIndex, e.target.value)}
                                            className="text-xs flex-1 min-w-0 resize-none"
                                            rows={2}
                                          />
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => removeArrayItem(workflowIndex, stepIndex, substepIndex, 'business_logic', logicIndex)}
                                            className="h-7 w-7 p-0 flex-shrink-0"
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}; 