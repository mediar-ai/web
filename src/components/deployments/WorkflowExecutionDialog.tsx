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
import { TypeScriptWorkflowMetadata } from '@/lib/typescript-workflow-parser';
import { Play, Loader2, AlertCircle, Clock } from 'lucide-react';
import cronstrue from 'cronstrue';

interface WorkflowExecutionDialogProps {
  workflow: WorkflowWithSettings | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExecutionStarted?: (executionId: number) => void;
}

// Helper function to transform TypeScript inputs to YAML parameters format
function transformTypeScriptInputs(
  inputs: TypeScriptWorkflowMetadata['inputs']
): Record<string, any> {
  const parameters: Record<string, any> = {};

  inputs.forEach(input => {
    // Map TypeScript type to YAML type
    let yamlType = input.type;
    if (input.type === 'string') yamlType = 'text';

    parameters[input.name] = {
      type: yamlType,
      label:
        input.name.charAt(0).toUpperCase() +
        input.name
          .slice(1)
          .replace(/([A-Z])/g, ' $1')
          .trim(),
      description: input.description,
      required: input.required,
      default: input.defaultValue,
    };
  });

  return parameters;
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
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [inputParameters, setInputParameters] = useState<Record<string, any>>(
    {}
  );

  // Fetch TypeScript metadata if needed
  useEffect(() => {
    if (!workflow) return;

    const fetchTypeScriptMetadata = async () => {
      // Check if this is a TypeScript workflow
      const isTypeScript = (workflow as any).preferred_format === 'typescript';

      if (!isTypeScript) {
        // YAML workflow - use input_parameters directly
        setInputParameters(workflow.input_parameters || {});
        return;
      }

      // TypeScript workflow - check if metadata is already cached
      const cachedMetadata = (workflow as any).typescript_metadata;

      if (cachedMetadata?.inputs) {
        // Use cached metadata
        const transformedParams = transformTypeScriptInputs(
          cachedMetadata.inputs
        );
        setInputParameters(transformedParams);
        return;
      }

      // Fetch metadata from API
      setLoadingMetadata(true);
      try {
        const response = await fetch(
          `/api/remote-workflows/${workflow.id}/typescript-metadata`
        );
        const data = await response.json();

        if (data.success && data.metadata?.inputs) {
          const transformedParams = transformTypeScriptInputs(
            data.metadata.inputs
          );
          setInputParameters(transformedParams);
        } else {
          // Fallback to empty parameters
          setInputParameters({});
        }
      } catch (err) {
        console.error('Failed to fetch TypeScript metadata:', err);
        setInputParameters({});
      } finally {
        setLoadingMetadata(false);
      }
    };

    fetchTypeScriptMetadata();
  }, [workflow]);

  useEffect(() => {
    if (workflow) {
      // Initialize parameters from transformed input_parameters
      const defaultParams: Record<string, any> = {};
      if (inputParameters) {
        Object.entries(inputParameters).forEach(
          ([key, config]: [string, any]) => {
            defaultParams[key] = config.default || '';
          }
        );
      }
      setParameters(defaultParams);
      setCronEnabled(workflow.cron_enabled || false);
    }
  }, [workflow, inputParameters]);

  const handleExecute = async () => {
    if (!workflow) return;

    setExecuting(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            execution_params: parameters,
          }),
        }
      );

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

  const hasParameters =
    inputParameters && Object.keys(inputParameters).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
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
            <div className="p-4 bg-gray-50 rounded border-2 border-black">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-mono font-bold uppercase">
                      Scheduled Execution
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    {(() => {
                      try {
                        return cronstrue.toString(workflow.cron_expression, {
                          verbose: false,
                        });
                      } catch {
                        return workflow.cron_expression;
                      }
                    })()}
                  </p>
                </div>
                <Button
                  variant="black-outline"
                  size="sm"
                  onClick={handleToggleCron}
                  disabled={executing}
                >
                  {cronEnabled ? 'Pause Schedule' : 'Resume Schedule'}
                </Button>
              </div>
            </div>
          )}

          {/* Loading State */}
          {loadingMetadata && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="ml-2 text-sm text-gray-600">
                Loading workflow parameters...
              </span>
            </div>
          )}

          {/* Parameters Section */}
          {!loadingMetadata && hasParameters && (
            <div className="space-y-4">
              <h3 className="text-sm font-mono font-bold uppercase">
                Workflow Parameters
              </h3>
              {Object.entries(inputParameters).map(
                ([key, config]: [string, any]) => (
                  <div key={key} className="space-y-2">
                    <Label
                      htmlFor={key}
                      className="font-mono text-xs text-gray-600 uppercase"
                    >
                      {config.label || key}
                      {config.required && (
                        <span className="text-red-500 ml-1">*</span>
                      )}
                    </Label>
                    {config.description && (
                      <p className="text-xs text-gray-500">
                        {config.description}
                      </p>
                    )}
                    {config.type === 'text' || config.type === 'multiline' ? (
                      <Textarea
                        id={key}
                        value={parameters[key] || ''}
                        onChange={e =>
                          setParameters({
                            ...parameters,
                            [key]: e.target.value,
                          })
                        }
                        placeholder={config.placeholder || config.default || ''}
                        rows={3}
                        className="font-mono text-sm border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    ) : (
                      <Input
                        id={key}
                        type={config.type === 'number' ? 'number' : 'text'}
                        value={parameters[key] || ''}
                        onChange={e =>
                          setParameters({
                            ...parameters,
                            [key]: e.target.value,
                          })
                        }
                        placeholder={config.placeholder || config.default || ''}
                        className="font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black"
                      />
                    )}
                  </div>
                )
              )}
            </div>
          )}

          {!loadingMetadata && !hasParameters && (
            <div className="text-sm text-gray-600">
              This workflow has no configurable parameters. Click &quot;Execute
              Now&quot; to run it.
            </div>
          )}

          {/* Error Display */}
          {error && (
            <Alert className="border-2 border-black bg-gray-100">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="black-outline"
            onClick={() => onOpenChange(false)}
            disabled={executing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleExecute}
            disabled={executing || loadingMetadata}
            className="bg-black text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-500"
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
