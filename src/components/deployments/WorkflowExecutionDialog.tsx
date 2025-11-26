'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { Play, Loader2, AlertCircle, Clock, Key, X } from 'lucide-react';
import cronstrue from 'cronstrue';

interface Secret {
  id: string;
  name: string;
  description: string | null;
}

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
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [showSecretsDropdown, setShowSecretsDropdown] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<'below' | 'above'>('below');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Track if we've loaded params from localStorage this session
  const hasLoadedParamsRef = useRef(false);

  // Reset flag and load params from localStorage immediately when dialog opens
  useEffect(() => {
    if (open && workflow) {
      hasLoadedParamsRef.current = false;

      // Immediately load last-used values from localStorage
      const storageKey = `workflow-params-${workflow.id}`;
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const lastUsedParams = JSON.parse(stored);
          setParameters(lastUsedParams);
          hasLoadedParamsRef.current = true;
        }
      } catch (e) {
        console.error('Error loading params from localStorage:', e);
      }
    }
  }, [open, workflow?.id]);

  // Fetch secrets when dialog opens
  useEffect(() => {
    if (!open) return;

    const fetchSecrets = async () => {
      try {
        setLoadingSecrets(true);
        const response = await fetch('/api/secrets');
        if (!response.ok) throw new Error('Failed to fetch secrets');
        const data = await response.json();
        setSecrets(data.secrets || []);
      } catch (err) {
        console.error('Error loading secrets:', err);
      } finally {
        setLoadingSecrets(false);
      }
    };

    fetchSecrets();
  }, [open]);

  // Calculate dropdown position when opening
  useEffect(() => {
    if (showSecretsDropdown && buttonRefs.current[showSecretsDropdown]) {
      const button = buttonRefs.current[showSecretsDropdown];
      if (button) {
        const buttonRect = button.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - buttonRect.bottom;
        const spaceAbove = buttonRect.top;

        // Assume dropdown height of ~256px (max-h-64 = 16rem = 256px)
        const dropdownHeight = 256;

        // If not enough space below but more space above, show above
        if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
          setDropdownPosition('above');
        } else {
          setDropdownPosition('below');
        }
      }
    }
  }, [showSecretsDropdown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowSecretsDropdown(null);
      }
    };

    if (showSecretsDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showSecretsDropdown]);

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

  // Merge any new inputParameter keys with existing params (don't overwrite existing values)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only depend on workflow?.id, not the whole object
  useEffect(() => {
    if (workflow && Object.keys(inputParameters).length > 0) {
      setCronEnabled(workflow.cron_enabled || false);

      // If we already loaded from localStorage, just ensure all keys exist (don't overwrite)
      if (hasLoadedParamsRef.current) {
        setParameters(prev => {
          const updated = { ...prev };
          Object.entries(inputParameters).forEach(([key, config]: [string, any]) => {
            // Only add missing keys, don't overwrite existing values
            if (!(key in updated)) {
              updated[key] = config.default ?? '';
            }
          });
          return updated;
        });
        return;
      }

      // First time - initialize from localStorage or defaults
      const defaultParams: Record<string, any> = {};
      const storageKey = `workflow-params-${workflow.id}`;
      let lastUsedParams: Record<string, any> = {};
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          lastUsedParams = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Error loading last-used params from localStorage:', e);
      }

      Object.entries(inputParameters).forEach(
        ([key, config]: [string, any]) => {
          defaultParams[key] = lastUsedParams[key] ?? config.default ?? '';
        }
      );
      setParameters(defaultParams);
      hasLoadedParamsRef.current = true;
    }
  }, [workflow?.id, inputParameters]);

  const handleExecute = async () => {
    if (!workflow) return;

    setExecuting(true);
    setError(null);

    // Save parameters to localStorage (excluding secret placeholders for privacy)
    try {
      const storageKey = `workflow-params-${workflow.id}`;
      const paramsToSave: Record<string, any> = {};

      Object.entries(parameters).forEach(([key, value]) => {
        // Don't save secret placeholders to localStorage
        if (typeof value === 'string' && value.match(/^\$\{.+\}$/)) {
          // Keep the placeholder in saved params (it's just a reference, not the secret value)
          paramsToSave[key] = value;
        } else {
          paramsToSave[key] = value;
        }
      });

      localStorage.setItem(storageKey, JSON.stringify(paramsToSave));
    } catch (e) {
      console.error('Error saving params to localStorage:', e);
    }

    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/execute`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parameters: parameters, // Changed from execution_params to parameters
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
                ([key, config]: [string, any]) => {
                  const isSecretValue = typeof parameters[key] === 'string' &&
                    parameters[key].match(/^\$\{.+\}$/);

                  return (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label
                          htmlFor={key}
                          className="font-mono text-xs text-gray-600 uppercase"
                        >
                          {config.label || key}
                          {config.required && (
                            <span className="text-red-500 ml-1">*</span>
                          )}
                        </Label>
                        {/* Secrets selector button */}
                        <div className="relative" ref={showSecretsDropdown === key ? dropdownRef : null}>
                          <Button
                            ref={(el) => {
                              buttonRefs.current[key] = el;
                            }}
                            type="button"
                            variant="black-outline"
                            size="sm"
                            onClick={() => {
                              setShowSecretsDropdown(showSecretsDropdown === key ? null : key);
                            }}
                            className="h-6 px-2 text-xs"
                            title="Select from secrets"
                          >
                            <Key className="w-3 h-3" />
                          </Button>

                          {/* Secrets dropdown */}
                          {showSecretsDropdown === key && (
                            <div className={`absolute right-0 w-64 bg-white border-2 border-black shadow-lg z-50 max-h-64 overflow-y-auto custom-scrollbar ${
                              dropdownPosition === 'above'
                                ? 'bottom-full mb-1'
                                : 'top-full mt-1'
                            }`}>
                              {loadingSecrets ? (
                                <div className="p-4 text-center">
                                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                                  <p className="text-xs text-gray-600 mt-2">Loading secrets...</p>
                                </div>
                              ) : secrets.length === 0 ? (
                                <div className="p-4 text-center">
                                  <p className="text-xs text-gray-600">No secrets configured</p>
                                  <p className="text-xs text-gray-500 mt-1">
                                    Go to Settings → Secrets to create one
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  {secrets.map((secret) => (
                                    <button
                                      key={secret.id}
                                      type="button"
                                      onClick={() => {
                                        setParameters({
                                          ...parameters,
                                          [key]: `\${${secret.name}}`,
                                        });
                                        setShowSecretsDropdown(null);
                                      }}
                                      className="w-full text-left px-3 py-2 hover:bg-gray-100 border-b border-gray-200 last:border-b-0"
                                    >
                                      <div className="flex items-center gap-2">
                                        <Key className="w-3 h-3 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <p className="font-mono text-xs font-bold truncate">
                                            {secret.name}
                                          </p>
                                          {secret.description && (
                                            <p className="text-xs text-gray-500 truncate">
                                              {secret.description}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {config.description && (
                        <p className="text-xs text-gray-500">
                          {config.description}
                        </p>
                      )}

                      {/* Display secret indicator or input field */}
                      {isSecretValue ? (
                        <div className="relative">
                          <div className="flex items-center gap-2 p-3 bg-gray-50 border-2 border-black font-mono text-sm">
                            <Key className="w-4 h-4 flex-shrink-0" />
                            <span className="flex-1">
                              Using secret: <strong>{parameters[key].replace(/^\$\{(.+)\}$/, '$1')}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setParameters({
                                  ...parameters,
                                  [key]: '',
                                });
                              }}
                              className="p-1 hover:bg-black hover:text-white transition-colors"
                              title="Clear secret"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : config.type === 'text' || config.type === 'multiline' ? (
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
                  );
                }
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
