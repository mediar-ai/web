'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { WorkflowWithSettings } from '@/lib/workflow-types';
import { Play, Loader2, AlertCircle, Clock } from 'lucide-react';
import cronstrue from 'cronstrue';

interface WorkflowExecutionDialogProps {
  workflow: WorkflowWithSettings | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExecutionStarted?: (executionId: number) => void;
}

export function WorkflowExecutionDialog({
  workflow,
  open,
  onOpenChange,
  onExecutionStarted,
}: WorkflowExecutionDialogProps) {
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parameters, setParameters] = useState<Record<string, any>>({});
  const [cronEnabled, setCronEnabled] = useState(false);

  useEffect(() => {
    if (workflow) {
      // Initialize parameters from workflow input_parameters
      const defaultParams: Record<string, any> = {};
      if (workflow.input_parameters) {
        Object.entries(workflow.input_parameters).forEach(([key, config]: [string, any]) => {
          defaultParams[key] = config.default || '';
        });
      }
      setParameters(defaultParams);
      setCronEnabled(workflow.cron_enabled || false);
    }
  }, [workflow]);

  const handleExecute = async () => {
    if (!workflow) return;

    setExecuting(true);
    setError(null);

    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          execution_params: parameters,
        }),
      });

      const result = await response.json();

      if (result.success) {
        onExecutionStarted?.(result.execution_id);
        onOpenChange(false);
      } else {
        setError(result.error || 'Failed to start execution');
      }
    } catch (err) {
      console.error('Execution error:', err);
      setError('Failed to execute workflow');
    } finally {
      setExecuting(false);
    }
  };

  const handleToggleCron = async () => {
    if (!workflow) return;

    setExecuting(true);
    setError(null);

    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cron_enabled: !cronEnabled,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setCronEnabled(!cronEnabled);
      } else {
        setError(result.error || 'Failed to update cron status');
      }
    } catch (err) {
      console.error('Cron toggle error:', err);
      setError('Failed to update cron status');
    } finally {
      setExecuting(false);
    }
  };

  if (!workflow) return null;

  const hasParameters = workflow.input_parameters && Object.keys(workflow.input_parameters).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="w-5 h-5" />
            Execute Workflow: {workflow.name}
          </DialogTitle>
          <DialogDescription>
            {workflow.description || 'Configure and run this workflow'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Cron Schedule Info */}
          {workflow.cron_expression && (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-gray-500" />
                    <span className="text-sm font-medium">Scheduled Execution</span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {(() => {
                      try {
                        return cronstrue.toString(workflow.cron_expression, { verbose: false });
                      } catch {
                        return workflow.cron_expression;
                      }
                    })()}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleToggleCron}
                  disabled={executing}
                  className={cronEnabled ? 'border-black' : 'border-gray-300'}
                >
                  {cronEnabled ? 'Pause Schedule' : 'Resume Schedule'}
                </Button>
              </div>
            </div>
          )}

          {/* Parameters Section */}
          {hasParameters ? (
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Workflow Parameters</h3>
              {Object.entries(workflow.input_parameters || {}).map(([key, config]: [string, any]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={key}>
                    {config.label || key}
                    {config.required && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  {config.description && (
                    <p className="text-xs text-gray-500">{config.description}</p>
                  )}
                  {config.type === 'text' || config.type === 'multiline' ? (
                    <Textarea
                      id={key}
                      value={parameters[key] || ''}
                      onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
                      placeholder={config.placeholder || config.default || ''}
                      rows={3}
                      className="font-mono text-sm"
                    />
                  ) : (
                    <Input
                      id={key}
                      type={config.type === 'number' ? 'number' : 'text'}
                      value={parameters[key] || ''}
                      onChange={(e) => setParameters({ ...parameters, [key]: e.target.value })}
                      placeholder={config.placeholder || config.default || ''}
                      className="font-mono"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              This workflow has no configurable parameters. Click &quot;Execute Now&quot; to run it.
            </div>
          )}

          {/* Error Display */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={executing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExecute}
            disabled={executing}
            className="bg-black text-white hover:bg-gray-800"
          >
            {executing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Execute Now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}