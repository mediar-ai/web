'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

import { PlusCircle, Trash2, RefreshCw, X, Edit3, Edit2, ChevronUp, ChevronDown } from 'lucide-react';

import { WorkflowBoundaries } from './types';

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
  progress,
  elapsedTime,
}: {
  status: string;
  progress: number;
  elapsedTime: number;
}) => (
  <div className="flex items-start gap-3 w-full">
    <div className="p-4 rounded-lg bg-background border w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <RefreshCw className="h-5 w-5 text-primary animate-spin" />
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">{status}</p>
          <p className="text-xs text-muted-foreground">
            Elapsed time: {elapsedTime.toFixed(1)}s
          </p>
        </div>
      </div>
      <Progress value={progress} className="mt-3 h-2" />
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
        {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
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
// RawInputView
// ----------------------------------------------------------------------------------
export const RawInputView = ({ title, data }: { title: string, data: object }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="mt-4 border-t pt-4">
      <button onClick={() => setIsOpen(!isOpen)} className="text-sm text-muted-foreground hover:text-foreground flex items-center">
        {isOpen ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
        {title}
      </button>
      {isOpen && (
        <pre className="mt-2 p-2 text-xs overflow-auto bg-gray-50 border rounded-md font-mono text-gray-700 max-h-96">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}; 