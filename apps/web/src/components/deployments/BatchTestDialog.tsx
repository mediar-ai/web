'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Loader2, Server, Bug } from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { BatchForm } from '@/components/deployments/BatchForm';
import { Workflow } from '@/lib/workflow-types';
import {
  getWorkflowRunPreferences,
  saveWorkflowRunPreferences,
  WorkflowRunPreferences,
} from '@/lib/workflow-run-preferences';
import { toast } from 'sonner';
import '@/styles/custom-scrollbar.css';

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
  last_health_check?: string | null;
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

interface WorkflowStep {
  id: string;
  name: string;
  tool_name: string;
}

interface BatchTestDialogProps {
  workflow: Workflow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit?: () => void;
  isMediarTeam?: boolean; // Show executor selection for Mediar team
}

export function BatchTestDialog({
  workflow,
  open,
  onOpenChange,
  onSubmit,
  isMediarTeam = false,
}: BatchTestDialogProps) {
  const searchParams = useSearchParams();
  const useLocalFile = searchParams.get('local') === 'true';

  const [batchSpec, setBatchSpec] = useState<BatchSpec>({
    static_parameters: {},
    dynamic_parameters: {},
  });
  const [totalCombinations, setTotalCombinations] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSpecValid, setIsSpecValid] = useState(true);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

  // Track previous workflow ID to detect changes
  const prevWorkflowIdRef = useRef<number | null>(null);

  // Track if preferences have been applied this session (to avoid reset on initial version load)
  const prefsAppliedRef = useRef(false);
  const savedPrefsRef = useRef<WorkflowRunPreferences | null>(null);
  // Track previous version to detect actual version changes vs initial load
  const prevVersionRef = useRef<string | null>(null);

  // Machine selection state
  const [availableMachines, setAvailableMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>(''); // Start with empty, will be set when machines load
  const [loadingMachines, setLoadingMachines] = useState(false);
  const userSelectedMachineRef = useRef(false); // Track if user manually selected a machine

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

  // Executor selection state
  const [executorType, setExecutorType] = useState<'python' | 'rust'>('python');

  // Partial execution state
  const [showPartialExecution, setShowPartialExecution] = useState(false);
  const [startFromStep, setStartFromStep] = useState<string>('');
  const [endAtStep, setEndAtStep] = useState<string>('');
  const [followFallback, setFollowFallback] = useState(false);
  const [executeJumpsAtEnd, setExecuteJumpsAtEnd] = useState(false);
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);

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

  // Reset state when dialog closes or workflow changes
  useEffect(() => {
    if (!open) {
      // Reset all state when dialog closes
      setSelectedVersionNumber('');
      setAvailableVersions([]);
      setVersionSchema(null);
      setVersionValidation(null);
      setSelectedMachineId('');
      setAvailableMachines([]);
      setExecutorType('python'); // Reset to Python executor
      setShowPartialExecution(false);
      setStartFromStep('');
      setEndAtStep('');
      setFollowFallback(false);
      setExecuteJumpsAtEnd(false);
      setWorkflowSteps([]);
      userSelectedMachineRef.current = false;
      prefsAppliedRef.current = false;
      savedPrefsRef.current = null;
      prevVersionRef.current = null;
    }
  }, [open]);

  // Load available machines and versions when dialog opens
  useEffect(() => {
    if (open && workflow) {
      // Check if workflow has changed
      const workflowChanged =
        prevWorkflowIdRef.current !== null &&
        prevWorkflowIdRef.current !== workflow.id;

      if (workflowChanged) {
        console.log(
          `[BatchTestDialog] Workflow changed from ${prevWorkflowIdRef.current} to ${workflow.id}, resetting state`
        );
        // Reset ALL state when workflow changes
        setSelectedVersionNumber('');
        setAvailableVersions([]);
        setVersionSchema(null);
        setVersionValidation(null);
        setSelectedMachineId('');
        setAvailableMachines([]);
        setExecutorType('python'); // Reset to Python executor
        setShowPartialExecution(false);
        setStartFromStep('');
        setEndAtStep('');
        setFollowFallback(false);
        setExecuteJumpsAtEnd(false);
        setWorkflowSteps([]);
        resetBatchSpec();
        prefsAppliedRef.current = false;
        savedPrefsRef.current = null;
        prevVersionRef.current = null;
      }

      // Update the ref with current workflow ID
      prevWorkflowIdRef.current = workflow.id;

      // Reset user selection flag when dialog opens
      userSelectedMachineRef.current = false;

      // Load saved preferences for this org+workflow
      if (!prefsAppliedRef.current && workflow.organization_id) {
        const savedPrefs = getWorkflowRunPreferences(
          workflow.organization_id,
          workflow.id
        );
        if (savedPrefs) {
          console.log('[BatchTestDialog] Loaded saved preferences:', savedPrefs);
          savedPrefsRef.current = savedPrefs;
          // Apply executor type immediately
          if (savedPrefs.executorType) {
            setExecutorType(savedPrefs.executorType);
          }
        }
      }

      const fetchMachines = async () => {
        setLoadingMachines(true);
        try {
          // Use the new accessible machines API endpoint
          const response = await fetch('/api/remote-machines/accessible');
          const data = await response.json();

          if (!response.ok) {
            console.error(
              '[ERROR] Failed to load accessible machines:',
              data.error
            );
            setAvailableMachines([]);
            return;
          }

          if (data.success && data.machines && data.machines.length > 0) {
            setAvailableMachines(data.machines);
            console.log(
              '📋 Loaded accessible machines for testing:',
              data.machines
            );

            // Set initial selection to first machine if no machine is selected yet
            if (!selectedMachineId && data.machines.length > 0) {
              // Check if we have a saved preference for machine
              const savedMachineId = savedPrefsRef.current?.machineId;
              const savedMachineExists = savedMachineId && data.machines.some(
                (m: Machine) => m.id.toString() === savedMachineId
              );

              if (savedMachineExists) {
                // Use saved machine preference
                setSelectedMachineId(savedMachineId);
                userSelectedMachineRef.current = true; // Prevent optimal machine override
                console.log(
                  '📋 Restored saved machine preference:',
                  savedMachineId
                );
              } else {
                // Sort machines by priority (active & healthy first, then by load)
                const sortedMachines = [...data.machines].sort(
                  (a: Machine, b: Machine) => {
                    // First prioritize active status
                    if (a.status === 'active' && b.status !== 'active') return -1;
                    if (a.status !== 'active' && b.status === 'active') return 1;

                    // Then prioritize healthy machines
                    if (
                      a.health_status === 'healthy' &&
                      b.health_status !== 'healthy'
                    )
                      return -1;
                    if (
                      a.health_status !== 'healthy' &&
                      b.health_status === 'healthy'
                    )
                      return 1;

                    // Finally sort by available capacity (higher is better)
                    const aCapacity = a.load_info?.available_capacity || 0;
                    const bCapacity = b.load_info?.available_capacity || 0;
                    return bCapacity - aCapacity;
                  }
                );

                setSelectedMachineId(sortedMachines[0].id.toString());
                console.log(
                  '📋 Auto-selected first priority machine:',
                  sortedMachines[0].name
                );
              }
            }

            // After loading machines, fetch optimal machine to potentially override default
            // Only fetch optimal if user hasn't manually selected a machine
            if (!userSelectedMachineRef.current) {
              await fetchOptimalMachine(data.machines);
            }
          } else {
            console.warn(
              '[WARNING] No accessible machines available:',
              data.message
            );
            setAvailableMachines([]);
          }
        } catch (error) {
          console.error('[ERROR] Error fetching accessible machines:', error);
          setAvailableMachines([]);
        } finally {
          setLoadingMachines(false);
        }
      };

      const fetchOptimalMachine = async (machines: Machine[]) => {
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
            // Check if the optimal machine is in our available machines list
            const optimalMachineExists = machines.some(
              m => m.id.toString() === data.machine_id.toString()
            );

            if (optimalMachineExists) {
              console.log(
                '🎯 Optimal machine assignment:',
                data.machine_id,
                data.machine_name,
                data.assignment_reason
              );
              setSelectedMachineId(data.machine_id.toString());
            } else {
              console.log(
                '🎯 Optimal machine not in available list, keeping current selection'
              );
            }
          } else {
            console.log(
              '🎯 No optimal machine found, keeping current selection'
            );
            // Don't change selection if no optimal machine found
          }
        } catch (error) {
          console.error('[ERROR] Error fetching optimal machine:', error);
          // Don't change selection on error
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

            // Check if we have a saved preference for version
            const savedVersionNumber = savedPrefsRef.current?.versionNumber;
            const savedVersionExists = savedVersionNumber && data.versions.some(
              (v: WorkflowVersion) => v.version_number === savedVersionNumber
            );

            if (savedVersionExists) {
              // Use saved version preference
              setSelectedVersionNumber(savedVersionNumber);
              console.log(
                '📋 Restored saved version preference:',
                savedVersionNumber
              );
            } else {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workflow, resetBatchSpec]); // Intentionally excluding selectedMachineId to prevent re-running when user manually selects

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
  }, [open, workflow, storageKey, resetBatchSpec]);

  // Load version-specific schema when version changes
  useEffect(() => {
    if (!workflow || !selectedVersionNumber) return;

    const loadVersionSchema = async () => {
      setLoadingVersionValidation(true);
      setVersionSchema(null); // Clear previous schema

      // Check if this is an actual version change vs initial load
      const isVersionChange = prevVersionRef.current !== null && prevVersionRef.current !== selectedVersionNumber;
      const isInitialLoad = prevVersionRef.current === null;

      // Only reset batch spec if user actually changed version (not on initial load)
      if (isVersionChange) {
        console.log('[BatchTestDialog] Version changed from', prevVersionRef.current, 'to', selectedVersionNumber, '- resetting batch spec');
        resetBatchSpec();
      }

      // Update the version ref
      prevVersionRef.current = selectedVersionNumber;

      try {
        // Use 'active' if no version selected, otherwise use the specific version
        const versionParam = !selectedVersionNumber
          ? 'active'
          : selectedVersionNumber;

        // Build URL with local parameter if enabled
        const localParam = useLocalFile ? '&local=true' : '';
        const response = await fetch(
          `/api/remote-workflows/${workflow.id}/schema?version=${versionParam}${localParam}`
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

          // On initial load, apply saved inputs if available and not yet applied
          if (isInitialLoad && !prefsAppliedRef.current && savedPrefsRef.current?.inputs) {
            const savedInputs = savedPrefsRef.current.inputs as Record<string, unknown>;
            if (Object.keys(savedInputs).length > 0) {
              console.log('[BatchTestDialog] Applying saved inputs preference:', savedInputs);
              setBatchSpec({
                static_parameters: savedInputs as JsonObject,
                dynamic_parameters: {},
              });
            }
            prefsAppliedRef.current = true;
          }
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
  }, [workflow, selectedVersionNumber, resetBatchSpec, useLocalFile]);

  // Load workflow steps when version changes
  useEffect(() => {
    if (!workflow || !selectedVersionNumber) return;

    const loadWorkflowSteps = async () => {
      setLoadingSteps(true);
      try {
        const versionParam = !selectedVersionNumber
          ? 'active'
          : selectedVersionNumber;
        const response = await fetch(
          `/api/remote-workflows/${workflow.id}/steps?version=${versionParam}`
        );
        const data = await response.json();

        if (data.success && data.steps) {
          setWorkflowSteps(data.steps);
          console.log(
            `[SUCCESS] Loaded ${data.steps.length} steps for workflow ${workflow.id}`
          );
        } else {
          console.warn('[WARN] Failed to load workflow steps:', data.error);
          setWorkflowSteps([]);
        }
      } catch (error) {
        console.error('[ERROR] Error loading workflow steps:', error);
        setWorkflowSteps([]);
      } finally {
        setLoadingSteps(false);
      }
    };

    loadWorkflowSteps();
  }, [workflow, selectedVersionNumber]);

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
    if (!workflow) return;

    // For workflows with no parameters, allow a single execution
    const effectiveTotalCombinations =
      totalCombinations === 0 &&
      (!workflow.input_parameters ||
        Object.keys(workflow.input_parameters).length === 0)
        ? 1
        : totalCombinations;

    if (effectiveTotalCombinations === 0) return;

    console.log('🚀 BatchTestDialog: Submitting batch with spec:', batchSpec);
    console.log(
      '🔢 BatchTestDialog: Total combinations:',
      effectiveTotalCombinations
    );
    console.log('🎯 BatchTestDialog: Selected machine ID:', selectedMachineId);
    console.log(
      '📋 BatchTestDialog: Selected version:',
      selectedVersionNumber || 'active version'
    );
    console.log(
      '🔍 BatchTestDialog: dynamic_parameters:',
      JSON.stringify(batchSpec.dynamic_parameters, null, 2)
    );
    console.log(
      '🔍 BatchTestDialog: static_parameters:',
      JSON.stringify(batchSpec.static_parameters, null, 2)
    );

    setIsSubmitting(true);
    try {
      // For workflows with no parameters, send an empty batch spec
      const effectiveBatchSpec =
        totalCombinations === 0
          ? { static_parameters: {}, dynamic_parameters: {} }
          : batchSpec;

      // Include machine_id, version_number, executor_type, and partial execution parameters in the request body
      const parsedMachineId = selectedMachineId
        ? parseInt(selectedMachineId, 10)
        : NaN;
      const validMachineId =
        !isNaN(parsedMachineId) && parsedMachineId > 0
          ? parsedMachineId
          : undefined;

      const requestBody = {
        ...effectiveBatchSpec,
        machine_id: validMachineId,
        version_number: selectedVersionNumber || undefined, // Send version or undefined for active
        executor_type: executorType, // 'python' or 'rust'
        // Partial execution parameters
        start_from_step:
          showPartialExecution && startFromStep ? startFromStep : undefined,
        end_at_step: showPartialExecution && endAtStep ? endAtStep : undefined,
        follow_fallback: showPartialExecution ? followFallback : undefined,
        execute_jumps_at_end: showPartialExecution
          ? executeJumpsAtEnd
          : undefined,
      };

      console.log(
        '📤 BatchTestDialog: Request body machine_id:',
        requestBody.machine_id,
        '(parsed from selectedMachineId:',
        selectedMachineId,
        ')'
      );

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

        // Save preferences for next time
        if (workflow.organization_id) {
          saveWorkflowRunPreferences(workflow.organization_id, workflow.id, {
            inputs: batchSpec.static_parameters,
            machineId: selectedMachineId,
            executorType,
            versionNumber: selectedVersionNumber,
          });
          console.log('[BatchTestDialog] Saved run preferences');
        }

        onOpenChange(false);
        if (onSubmit) {
          onSubmit();
        }
      } else {
        console.error(
          '[ERROR] BatchTestDialog: Failed to submit test run:',
          data.error
        );
        toast.error(`Failed to submit test run: ${data.error}`);
      }
    } catch (error) {
      console.error(
        '[ERROR] BatchTestDialog: Error submitting test run:',
        error
      );
      toast.error('Failed to submit test run execution');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDefaults = async () => {
    if (!workflow) return;

    // Show confirmation dialog
    const confirmed = window.confirm(
      'This will create a new workflow version with these values as defaults. Continue?'
    );

    if (!confirmed) return;

    console.log('💾 Saving defaults with spec:', batchSpec.dynamic_parameters);

    setIsSavingDefaults(true);
    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/save-defaults`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dynamic_parameters: batchSpec.dynamic_parameters,
          }),
        }
      );

      const data = await response.json();
      console.log('📡 Save defaults response:', data);

      if (data.success) {
        console.log('[SUCCESS] Defaults saved:', data.version);
        toast.success(
          data.message ||
            `Saved as default (version ${data.version.version_number})`
        );

        // Close dialog after successful save
        onOpenChange(false);
        if (onSubmit) {
          onSubmit();
        }
      } else {
        console.error('[ERROR] Failed to save defaults:', data.error);
        toast.error(`Failed to save defaults: ${data.error}`);
      }
    } catch (error) {
      console.error('[ERROR] Error saving defaults:', error);
      toast.error('Failed to save defaults');
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const selectedMachine = availableMachines.find(
    m => m.id.toString() === selectedMachineId
  );

  if (!workflow) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[100vh] overflow-hidden flex flex-col border-black">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="text-2xl font-bold">
            Manual run options: {workflow.name}
          </DialogTitle>
          <p className="text-muted-foreground text-sm mt-1">
            Configure and run a test suite for this workflow.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
          {/* Execution Settings */}
          <Card className="border-black">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="w-4 h-4" />
                Execution Settings
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Choose which machine to run the test on. Defaults to development
                machine.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 py-3 px-3">
              <div className="space-y-1.5 min-w-0">
                <Label htmlFor="machine-select" className="text-xs">
                  Target Machine
                </Label>
                {loadingMachines ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading machines...
                  </div>
                ) : availableMachines.length === 0 ? (
                  <div className="border-2 border-black p-2 bg-gray-50">
                    <p className="text-xs font-mono mb-1">
                      No remote machines available for your organization.
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">
                      Your organization needs access to at least one remote
                      machine to execute workflows.
                    </p>
                    <a
                      href="https://mediar.ai/contact"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-2 py-1 bg-black text-white hover:bg-gray-800 transition-colors text-xs font-mono uppercase"
                    >
                      Contact Support
                    </a>
                  </div>
                ) : (
                  <Select
                    value={selectedMachineId}
                    onValueChange={value => {
                      setSelectedMachineId(value);
                      userSelectedMachineRef.current = true; // Mark that user has made a manual selection
                    }}
                  >
                    <SelectTrigger
                      id="machine-select"
                      className="h-7 text-xs px-2 w-full [&>span]:block [&>span]:truncate"
                      title={selectedMachine?.name}
                    >
                      <SelectValue placeholder="Select a machine" />
                    </SelectTrigger>
                    <SelectContent className="min-w-[400px]">
                      {availableMachines.map(machine => {
                        // Determine machine status for display
                        const isActive = machine.status === 'active';
                        const now = new Date();
                        const lastCheck = machine.last_health_check
                          ? new Date(machine.last_health_check)
                          : null;
                        const isHealthy =
                          lastCheck &&
                          now.getTime() - lastCheck.getTime() < 5 * 60 * 1000 &&
                          machine.health_status === 'healthy';

                        // Show different indicators based on machine state
                        let statusIndicator = '⚫'; // Default unknown
                        if (isActive && isHealthy) {
                          statusIndicator = '🟢'; // Active and healthy
                        } else if (isActive && !isHealthy) {
                          statusIndicator = '🟡'; // Active but unhealthy
                        } else if (!isActive) {
                          statusIndicator = '🔴'; // Inactive/maintenance/failed
                        }

                        return (
                          <SelectItem
                            key={`machine-${machine.id}`}
                            value={machine.id.toString()}
                            disabled={false}
                            className="text-xs py-1.5"
                          >
                            <div className="flex items-center gap-2 w-full">
                              <span className="flex-shrink-0">
                                {statusIndicator}
                              </span>
                              <span
                                className="flex-1 truncate"
                                title={machine.name}
                              >
                                {machine.name}
                              </span>
                            </div>
                          </SelectItem>
                        );
                      })}
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

              <div className="space-y-1.5">
                <Label htmlFor="version-select" className="text-xs">
                  Workflow Version
                </Label>
                {loadingVersions ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading versions...
                  </div>
                ) : availableVersions.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No versions available
                  </div>
                ) : (
                  <Select
                    value={selectedVersionNumber}
                    onValueChange={setSelectedVersionNumber}
                  >
                    <SelectTrigger
                      id="version-select"
                      className="h-7 text-xs px-2"
                    >
                      <SelectValue placeholder="Active version" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableVersions.map(version => (
                        <SelectItem
                          key={`version-${version.version_id}`}
                          value={version.version_number}
                          className="text-xs py-1"
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

              {/* Executor Type Selection (available to all users) */}
              <div className="col-span-2 space-y-1.5 mt-2 pt-2 border-t border-gray-200">
                <Label
                  htmlFor="executor-select"
                  className="font-mono text-xs uppercase"
                >
                  Executor Type
                </Label>
                <Select
                  value={executorType}
                  onValueChange={value =>
                    setExecutorType(value as 'python' | 'rust')
                  }
                >
                  <SelectTrigger
                    id="executor-select"
                    className="h-7 text-xs px-2"
                  >
                    <SelectValue placeholder="Select executor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="python" className="text-xs py-1">
                      Python Executor (Default)
                    </SelectItem>
                    <SelectItem value="rust" className="text-xs py-1">
                      Rust Executor (Experimental)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="text-xs text-muted-foreground">
                  {executorType === 'python'
                    ? 'Using stable Python-based workflow executor (Modal)'
                    : 'Using experimental Rust-based executor (Azure Container Instances, faster, limited features)'}
                </div>
              </div>

              {/* Partial Execution (Debug Mode) */}
              <div className="col-span-2 space-y-2 mt-2 pt-2 border-t border-gray-200">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="partial-execution-toggle"
                    checked={showPartialExecution}
                    onCheckedChange={checked =>
                      setShowPartialExecution(checked as boolean)
                    }
                  />
                  <Label
                    htmlFor="partial-execution-toggle"
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Bug className="w-4 h-4" />
                    <span className="font-medium">
                      Partial Execution (Debug Mode)
                    </span>
                  </Label>
                </div>

                {showPartialExecution && (
                  <div className="p-2 border-2 border-black rounded bg-gray-50 space-y-2">
                    {loadingSteps ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading workflow steps...
                      </div>
                    ) : workflowSteps.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No steps available for this workflow
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label
                              htmlFor="start-step-select"
                              className="text-xs font-mono uppercase"
                            >
                              Start from step
                            </Label>
                            <Select
                              value={startFromStep}
                              onValueChange={setStartFromStep}
                            >
                              <SelectTrigger
                                id="start-step-select"
                                className="font-mono text-xs h-7 px-2"
                              >
                                <SelectValue placeholder="From beginning" />
                              </SelectTrigger>
                              <SelectContent>
                                {workflowSteps.map(step => (
                                  <SelectItem
                                    key={step.id}
                                    value={step.id}
                                    className="font-mono text-xs py-1"
                                  >
                                    {step.id}
                                    <span className="text-xs text-muted-foreground ml-2">
                                      ({step.name})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1.5">
                            <Label
                              htmlFor="end-step-select"
                              className="text-xs font-mono uppercase"
                            >
                              End at step
                            </Label>
                            <Select
                              value={endAtStep}
                              onValueChange={setEndAtStep}
                            >
                              <SelectTrigger
                                id="end-step-select"
                                className="font-mono text-xs h-7 px-2"
                              >
                                <SelectValue placeholder="Until end" />
                              </SelectTrigger>
                              <SelectContent>
                                {workflowSteps.map(step => (
                                  <SelectItem
                                    key={step.id}
                                    value={step.id}
                                    className="font-mono text-xs py-1"
                                  >
                                    {step.id}
                                    <span className="text-xs text-muted-foreground ml-2">
                                      ({step.name})
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="follow-fallback"
                              checked={followFallback}
                              onCheckedChange={checked =>
                                setFollowFallback(checked as boolean)
                              }
                            />
                            <Label
                              htmlFor="follow-fallback"
                              className="text-xs cursor-pointer"
                            >
                              Follow fallback beyond end step
                            </Label>
                          </div>

                          <div className="flex items-center gap-2">
                            <Checkbox
                              id="execute-jumps"
                              checked={executeJumpsAtEnd}
                              onCheckedChange={checked =>
                                setExecuteJumpsAtEnd(checked as boolean)
                              }
                            />
                            <Label
                              htmlFor="execute-jumps"
                              className="text-xs cursor-pointer"
                            >
                              Execute jumps at end step
                            </Label>
                          </div>
                        </div>

                        <div className="text-xs text-muted-foreground pt-1.5 border-t border-gray-300">
                          <p className="font-mono">
                            {startFromStep || endAtStep ? (
                              <>
                                Will execute: {startFromStep || 'beginning'} →{' '}
                                {endAtStep || 'end'}
                              </>
                            ) : (
                              'Select start and/or end steps to run a partial execution'
                            )}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Batch Summary */}
          <Card className="border-black">
            <CardContent className="py-2 px-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <h3 className="text-base font-semibold">Test Run Summary</h3>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs uppercase text-muted-foreground">
                      Total Combinations:
                    </span>
                    <span className="text-2xl font-bold">
                      {totalCombinations === 0 &&
                      (!workflow.input_parameters ||
                        Object.keys(workflow.input_parameters).length === 0)
                        ? 1
                        : totalCombinations}
                    </span>
                    {totalCombinations > 5000 && (
                      <span className="text-red-500 text-xs font-semibold">
                        (Exceeds limit of 5000)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <Button
                    variant="outline"
                    size="default"
                    disabled={
                      totalCombinations !== 1 ||
                      isSavingDefaults ||
                      isSubmitting ||
                      !isSpecValid
                    }
                    onClick={handleSaveDefaults}
                    className="border-black hover:bg-black hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSavingDefaults ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </div>
                    ) : (
                      'Save as default'
                    )}
                  </Button>
                  <Button
                    size="default"
                    disabled={
                      (totalCombinations === 0 &&
                        workflow.input_parameters &&
                        Object.keys(workflow.input_parameters).length > 0) ||
                      isSubmitting ||
                      isSavingDefaults ||
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
                      (() => {
                        const count =
                          totalCombinations === 0 &&
                          (!workflow.input_parameters ||
                            Object.keys(workflow.input_parameters).length === 0)
                            ? 1
                            : totalCombinations;
                        return `Queue ${count} Execution${count === 1 ? '' : 's'}`;
                      })()
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Variable Configurator */}
          <Card className="border-black">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm">Variable Configurator</CardTitle>
              <p className="text-xs text-muted-foreground">
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
                  <div className="max-h-[50vh] overflow-y-auto custom-scrollbar">
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
