import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Edit2, Save, X } from 'lucide-react';
import type { Workflow } from '../../types';

interface WorkflowTabContentProps {
  workflow: Workflow | null;
  onWorkflowUpdate: (workflow: Workflow) => void;
}

const WorkflowTabContent: React.FC<WorkflowTabContentProps> = ({
  workflow,
  onWorkflowUpdate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [workflowName, setWorkflowName] = useState(workflow?.name || '');

  const handleSave = () => {
    if (workflowName.trim()) {
      const updatedWorkflow: Workflow = {
        id: workflow?.id || crypto.randomUUID(),
        name: workflowName.trim(),
        description: workflow?.description || '',
        createdAt: workflow?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sessionId: workflow?.sessionId || localStorage.getItem('app_session_id') || crypto.randomUUID(),
      };
      onWorkflowUpdate(updatedWorkflow);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setWorkflowName(workflow?.name || '');
    setIsEditing(false);
  };

  const startEditing = () => {
    setWorkflowName(workflow?.name || '');
    setIsEditing(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-lg font-semibold">Workflow Overview</CardTitle>
          {!isEditing && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Edit2 className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-name">Workflow Name</Label>
            {isEditing ? (
              <div className="flex gap-2">
                <Input
                  id="workflow-name"
                  value={workflowName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkflowName(e.target.value)}
                  placeholder="Enter workflow name..."
                  className="flex-1"
                  autoFocus
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') {
                      handleSave();
                    } else if (e.key === 'Escape') {
                      handleCancel();
                    }
                  }}
                />
                <Button size="sm" onClick={handleSave} disabled={!workflowName.trim()}>
                  <Save className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" onClick={handleCancel}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="min-h-[40px] flex items-center">
                {workflow?.name ? (
                  <p className="text-sm font-medium">{workflow.name}</p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    No workflow name set. Click Edit to add one.
                  </p>
                )}
              </div>
            )}
          </div>

          {workflow && (
            <div className="pt-4 border-t space-y-2">
              <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Created:</span>{' '}
                  {new Date(workflow.createdAt).toLocaleString()}
                </div>
                <div>
                  <span className="font-medium">Updated:</span>{' '}
                  {new Date(workflow.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Session ID:</span>{' '}
                <code className="bg-muted px-1 py-0.5 rounded text-[10px]">
                  {workflow.sessionId}
                </code>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Placeholder for future workflow details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Coming Soon
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>• Workflow description and goals</p>
            <p>• Step-by-step breakdown</p>
            <p>• Apps and tools used</p>
            <p>• Key facts and business rules</p>
            <p>• Auto-generated from your activity</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default WorkflowTabContent; 