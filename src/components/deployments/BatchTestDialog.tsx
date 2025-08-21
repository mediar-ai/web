'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Server } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { BatchForm } from '@/components/deployments/BatchForm';
import { Workflow } from '@/lib/workflow-types';

type JsonValue =
  | string
  | number
  | boolean
  | { [x: string]: JsonValue }
  | Array<JsonValue>
  | null;
type JsonObject = { [x: string]: JsonValue };

interface BatchSpec {
  static_parameters: JsonObject;
  dynamic_parameters: Record<string, JsonValue[]>;
}

interface Machine {
  id: number;
  name: string;
  machine_type: string;
  status: string;
  health_status: string;
  load_info?: {
    current_executions: number;
    load_percentage: number;
    available_capacity: number;
  };
}

interface WorkflowVersion {
  version_id: number;
  workflow_id?: number;
  version_number: string;
  is_active: boolean;
  created_at: string;
  change_notes?: string;
  execution_count?: number;
}

interface BatchTestDialogProps {
  workflow: Workflow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: () => void;
}

export function BatchTestDialog({
  workflow,
  open,
  onOpenChange,
  onSubmit,
}: BatchTestDialogProps) {
  const [batchSpec, setBatchSpec] = useState<BatchSpec>({
    static_parameters: {},
    dynamic_parameters: {},
  });
  const [totalCombinations, setTotalCombinations] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSpecValid, setIsSpecValid] = useState(true);

  // Machine selection state
  const [availableMachines, setAvailableMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('1'); // Will be updated based on workflow assignments
  const [loadingMachines, setLoadingMachines] = useState(false);

  // Version selection state
  const [availableVersions, setAvailableVersions] = useState<WorkflowVersion[]>(
    []
  );
  const [selectedVersionNumber, setSelectedVersionNumber] =
    useState<string>('');

  // Version-specific schema state - stores schema for the selected version
  const [versionSchema, setVersionSchema] = useState<{
    input_parameters: JsonObject;
    sample_inputs: JsonObject;
    version_number: string;
  } | null>(null);

  // Version-specific validation state (for safety, but we still use workflow.input_parameters for UI)
  const [versionValidation, setVersionValidation] = useState<{
    version_number: string;
    is_valid: boolean;
    error?: string;
  } | null>(null);
  const [loadingVersionValidation, setLoadingVersionValidation] =
    useState(false); // Default to active version
  const [loadingVersions, setLoadingVersions] = useState(false);

  // Create a storage key specific to this workflow
  const storageKey = workflow ? `test-run-${workflow.id}` : '';

  const resetBatchSpec = useCallback(() => {
    setBatchSpec({
      static_parameters: {},
      dynamic_parameters: {},
    });
    setTotalCombinations(0);
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  // Load available machines and versions when dialog opens
  useEffect(() => {
    if (open && workflow) {
      const fetchMachines = async () => {
        setLoadingMachines(true);
        try {
          const response = await fetch(
            '/api/machines?status=active&include_load=true'
          );
          const data = await response.json();

          if (data.success) {
            setAvailableMachines(data.machines);
            console.log('📋 Loaded machines for testing:', data.machines);

            // After loading machines, fetch optimal machine to set preferred default
            await fetchOptimalMachine(data.machines);
          } else {
            console.error('[ERROR] Failed to load machines:', data.error);
          }
        } catch (error) {
          console.error('[ERROR] Error fetching machines:', error);
        } finally {
          setLoadingMachines(false);
        }
      };

      const fetchOptimalMachine = async (_machines: Machine[]) => {
        try {
          // Use the same logic as backend execution routes
          const response = await fetch(
            `/api/remote-workflows/${workflow.id}/optimal-machine`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ execution_params: {} }),
            }
          );
          const data = await response.json();

          if (data.success && data.machine_id) {
            console.log(
              '🎯 Optimal machine assignment:',
              data.machine_id,
              data.machine_name,
              data.assignment_reason
            );
            setSelectedMachineId(data.machine_id.toString());
          } else {
            console.log(
              '🎯 No optimal machine found, using fallback machine 1'
            );
            setSelectedMachineId('1'); // Fallback to machine 1 if no optimal machine
          }
        } catch (error) {
          console.error('[ERROR] Error fetching optimal machine:', error);
          setSelectedMachineId('1'); // Fallback to machine 1 on error
        }
      };

      const fetchVersions = async () => {
        setLoadingVersions(true);
        try {
          const response = await fetch(
            `/api/remote-workflows/${workflow.id}/versions`
          );
          const data = await response.json();

          if (data.success) {
            setAvailableVersions(data.versions);
            console.log('📋 Loaded versions for testing:', data.versions);

            // Set default to the actual active version from the list
            const activeVersion = data.versions.find(
              (v: WorkflowVersion) => v.is_active
            );
            if (activeVersion) {
              setSelectedVersionNumber(activeVersion.version_number);
              console.log(
                '📋 Auto-selected active version:',
                activeVersion.version_number
              );
            } else {
              // Fallback to empty string if no active version found (will use 'active' in API calls)
              setSelectedVersionNumber('');
              console.warn('⚠️ No active version found in version list');
            }
          } else {
            console.error('[ERROR] Failed to load versions:', data.error);
          }
        } catch (error) {
          console.error('[ERROR] Error fetching versions:', error);
        } finally {
          setLoadingVersions(false);
        }
      };

      fetchMachines();
      fetchVersions();
    }
  }, [open, workflow?.id]);

  // Load saved batch spec when dialog opens
  useEffect(() => {
    if (open && workflow && storageKey) {
      const savedSpec = localStorage.getItem(storageKey);
      if (savedSpec) {
        try {
          const parsedSpec = JSON.parse(savedSpec);
          setBatchSpec(parsedSpec);
        } catch (e) {
          console.error('Failed to parse saved batch spec:', e);
          resetBatchSpec();
        }
      } else {
        resetBatchSpec();
      }
    }
  }, [open, workflow?.id, storageKey, resetBatchSpec]);

  // Load version-specific schema when version changes
  useEffect(() => {
    if (!workflow || !selectedVersionNumber) return;

    const loadVersionSchema = async () => {
      setLoadingVersionValidation(true);
      setVersionSchema(null); // Clear previous schema
      resetBatchSpec(); // Reset form values when switching versions

      try {
        // Use 'active' if no version selected, otherwise use the specific version
        const versionParam = !selectedVersionNumber
          ? 'active'
          : selectedVersionNumber;
        const response = await fetch(
          `/api/remote-workflows/${workflow.id}/schema?version=${versionParam}`
        );
        const data = await response.json();

        if (data.success) {
          // Set both validation state and schema
          setVersionValidation({
            version_number: data.workflow.version,
            is_valid: true,
          });

          // Store the complete schema for the selected version
          setVersionSchema({
            input_parameters: data.schema?.input_parameters || {},
            sample_inputs: data.schema?.sample_request || {},
            version_number: data.workflow.version,
          });

          console.log(
            '[SUCCESS] Version schema loaded:',
            data.workflow.version
          );
          console.log('[DEBUG] Full data object:', data);
          console.log('[DEBUG] Schema object:', data.schema);
          console.log(
            '[DEBUG] Input parameters object:',
            data.schema?.input_parameters
          );
          console.log(
            '[DEBUG] Schema parameters:',
            Object.keys(data.schema?.input_parameters || {})
          );
        } else {
          setVersionValidation({
            version_number: selectedVersionNumber,
            is_valid: false,
            error: data.error,
          });
          console.warn('[WARN] Version schema loading failed:', data.error);
        }
      } catch (error) {
        console.error('[ERROR] Error loading version schema:', error);
        setVersionValidation({
          version_number: selectedVersionNumber,
          is_valid: false,
          error: 'Network error',
        });
      } finally {
        setLoadingVersionValidation(false);
      }
    };

    loadVersionSchema();
  }, [workflow?.id, selectedVersionNumber]);

  // Save batch spec to localStorage whenever it changes
  useEffect(() => {
    if (storageKey && Object.keys(batchSpec).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(batchSpec));
    }
  }, [batchSpec, storageKey]);

  const handleSpecChange = useCallback((spec: BatchSpec, isValid: boolean) => {
    setBatchSpec(spec);
    setIsSpecValid(isValid);
  }, []);

  const handleBatchSubmit = async () => {
    if (!workflow || !batchSpec || totalCombinations === 0) return;

    console.log('🚀 BatchTestDialog: Submitting batch with spec:', batchSpec);
    console.log('🔢 BatchTestDialog: Total combinations:', totalCombinations);
    console.log('🎯 BatchTestDialog: Selected machine ID:', selectedMachineId);
    console.log(
      '📋 BatchTestDialog: Selected version:',
      selectedVersionNumber || 'active version'
    );

    setIsSubmitting(true);
    try {
      // Include machine_id and version_number in the request body
      const requestBody = {
        ...batchSpec,
        machine_id: parseInt(selectedMachineId),
        version_number: selectedVersionNumber || undefined, // Send version or undefined for active
      };

      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/batch-execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        }
      );

      const data = await response.json();
      console.log('📡 BatchTestDialog: Server response:', data);

      if (data.success) {
        console.log('[SUCCESS] BatchTestDialog: Batch submission successful');
        console.log('🎯 BatchTestDialog: Execution IDs:', data.execution_ids);
        onOpenChange(false);
        if (onSubmit) {
          onSubmit();
        }
      } else {
        console.error(
          '[ERROR] BatchTestDialog: Failed to submit test run:',
          data.error
        );
        alert(`Failed to submit test run: ${data.error}`);
      }
    } catch (error) {
      console.error(
        '[ERROR] BatchTestDialog: Error submitting test run:',
        error
      );
      alert('Failed to submit test run execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedMachine = availableMachines.find(
    m => m.id.toString() === selectedMachineId
  );

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border-black">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-2xl font-bold">
            Test Run: {workflow.name}
          </DialogTitle>
          <p className="text-muted-foreground text-sm mt-1">
            Configure and run a test suite for this workflow.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {/* Execution Settings */}
          <Card className="border-black">
            <CardHeader className="py-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="w-4 h-4" />
                Execution Settings
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Choose which machine to run the test on. Defaults to development
                machine.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="machine-select">Target Machine</Label>
                {loadingMachines ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading machines...
                  </div>
                ) : (
                  <Select
                    value={selectedMachineId}
                    onValueChange={setSelectedMachineId}
                  >
                    <SelectTrigger id="machine-select">
                      <SelectValue placeholder="Select a machine" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableMachines.map(machine => (
                        <SelectItem
                          key={`machine-${machine.id}`}
                          value={machine.id.toString()}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  machine.health_status === 'healthy'
                                    ? 'bg-green-500'
                                    : machine.health_status === 'unhealthy'
                                      ? 'bg-red-500'
                                      : 'bg-yellow-500'
                                }`}
                              />
                              <span className="font-medium">
                                {machine.name}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({machine.machine_type})
                              </span>
                            </div>
                            {machine.load_info && (
                              <span className="text-xs text-muted-foreground ml-2">
                                {machine.load_info.current_executions}/
                                {machine.load_info.available_capacity +
                                  machine.load_info.current_executions}{' '}
                                jobs
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {selectedMachine && (
                  <div className="text-xs text-muted-foreground flex items-center gap-4">
                    <span>{selectedMachine.health_status}</span>
                    {selectedMachine.load_info && (
                      <span>
                        Load: {selectedMachine.load_info.load_percentage}%
                      </span>
                    )}
                    <span className="capitalize">{selectedMachine.status}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="version-select">Workflow Version</Label>
                {loadingVersions ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading versions...
                  </div>
                ) : (
                  <Select
                    value={selectedVersionNumber}
                    onValueChange={setSelectedVersionNumber}
                  >
                    <SelectTrigger id="version-select">
                      <SelectValue placeholder="Active version" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableVersions.map(version => (
                        <SelectItem
                          key={`version-${version.version_id}`}
                          value={version.version_number}
                        >
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  version.is_active
                                    ? 'bg-green-500'
                                    : 'bg-gray-400'
                                }`}
                              />
                              <span className="font-medium">
                                v{version.version_number}
                              </span>
                              {version.is_active && (
                                <span className="text-xs text-green-600 font-medium">
                                  (Active)
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground ml-2">
                              {new Date(
                                version.created_at
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {selectedVersionNumber ? (
                  <div
                    key="version-selected"
                    className="text-xs text-muted-foreground"
                  >
                    Testing with version:{' '}
                    <span className="font-mono">{selectedVersionNumber}</span>
                    {loadingVersionValidation && (
                      <span className="ml-2">loading...</span>
                    )}
                    {versionValidation && !versionValidation.is_valid && (
                      <span className="ml-2 text-yellow-600">
                        {versionValidation.error}
                      </span>
                    )}
                    {versionValidation && versionValidation.is_valid && (
                      <span className="ml-2 text-green-600">validated</span>
                    )}
                  </div>
                ) : (
                  <div
                    key="version-active"
                    className="text-xs text-muted-foreground"
                  >
                    Using active/production version
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Batch Summary */}
          <Card className="border-black">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <h3 className="text-base font-semibold">Test Run Summary</h3>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs uppercase text-muted-foreground">
                      Total Combinations:
                    </span>
                    <span className="text-2xl font-bold">
                      {totalCombinations}
                    </span>
                    {totalCombinations > 5000 && (
                      <span className="text-red-500 text-xs font-semibold">
                        (Exceeds limit of 5000)
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  className="ml-4"
                  size="default"
                  disabled={
                    totalCombinations === 0 ||
                    isSubmitting ||
                    totalCombinations > 5000 ||
                    !isSpecValid ||
                    !selectedMachineId
                  }
                  onClick={handleBatchSubmit}
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Submitting...
                    </div>
                  ) : (
                    `Queue ${totalCombinations} Execution${totalCombinations === 1 ? '' : 's'}`
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Variable Configurator */}
          <Card className="border-black">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Variable Configurator</CardTitle>
              <p className="text-sm text-muted-foreground">
                Define static values or iterate over multiple dynamic values for
                each parameter.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {(() => {
                // Use version-specific schema if available, otherwise fall back to workflow schema
                const currentSchema =
                  versionSchema?.input_parameters || workflow.input_parameters;
                const currentSampleInputs =
                  versionSchema?.sample_inputs || workflow.sample_inputs;

                return currentSchema &&
                  Object.keys(currentSchema).length > 0 ? (
                  <div className="max-h-[50vh] overflow-y-auto">
                    {loadingVersionValidation && (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        Loading version schema...
                      </div>
                    )}
                    <BatchForm
                      key={versionSchema?.version_number || 'default'} // Force re-render on version change
                      schema={currentSchema as JsonObject}
                      initialValues={currentSampleInputs as JsonObject}
                      onSpecChange={handleSpecChange}
                      onCombinationsChange={setTotalCombinations}
                      initialSpec={batchSpec}
                    />
                  </div>
                ) : (
                  <p className="p-6">
                    {loadingVersionValidation
                      ? 'Loading parameters...'
                      : 'This workflow has no configurable parameters.'}
                  </p>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
