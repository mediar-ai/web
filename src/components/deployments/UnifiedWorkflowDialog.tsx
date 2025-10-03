'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Terminal, Package, Monitor, Star, Trash2, Loader2, Check, AlertCircle, FileCode, FilePlus, Upload, Edit, Save, X, Clock } from 'lucide-react';
import { CodeBlock, JsonBlock } from '@/components/ui/code-block';
import { formatDuration } from './utils';
import { YamlEditorWithHighlight } from '@/components/YamlEditorWithHighlight';
import * as yaml from 'js-yaml';
import { CronScheduleEditor, type CronConfig } from './CronScheduleEditor';

interface WorkflowVersion {
  version_number: string;
  is_active: boolean;
  created_at: string;
  execution_count: number;
  automation_sequence?: string;
}

interface Machine {
  id: number;
  name: string;
  status: string;
  mcp_endpoint: string;
  current_load?: number;
  max_concurrent?: number;
  health_status?: string;
  health_details?: any;
  uptime_seconds?: number;
  last_health_check?: string;
}

interface MachineAssignment {
  assignment_id: number;
  machine_id: number;
  assignment_type: 'exclusive' | 'preferred';
  priority: number;
  machine_name: string;
}

interface UnifiedWorkflowDialogProps {
  workflow: any | null; // Accept any workflow type since we handle both
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsUpdated?: () => void;
  onUseAsTemplate?: (yaml: string, name: string) => void;
}

export function UnifiedWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onSettingsUpdated,
  onUseAsTemplate
}: UnifiedWorkflowDialogProps) {
  // Version management state
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [activatingVersion, setActivatingVersion] = useState<string | null>(null);
  const [currentYaml, setCurrentYaml] = useState<string>('');
  const [loadingYaml, setLoadingYaml] = useState(false);
  const [editedYaml, setEditedYaml] = useState<string>('');
  const [isEditingYaml, setIsEditingYaml] = useState(false);
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ success: boolean; message: string } | null>(null);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<string>(''); // Track selected version for viewing

  // Inline editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [savingNameDescription, setSavingNameDescription] = useState(false);

  // Machine assignment state
  const [availableMachines, setAvailableMachines] = useState<Machine[]>([]);
  const [machineAssignments, setMachineAssignments] = useState<MachineAssignment[]>([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [selectedAssignmentType, setSelectedAssignmentType] = useState<'exclusive' | 'preferred'>('preferred');
  const [addingAssignment, setAddingAssignment] = useState(false);
  const [removingAssignment, setRemovingAssignment] = useState<number | null>(null);

  // Feedback state
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Cron schedule state
  const [cronConfig, setCronConfig] = useState<CronConfig>({
    expression: '',
    timezone: 'UTC',
    enabled: false,
    maxConcurrent: 1,
    retryOnFailure: true,
    retryCount: 3,
  });
  const [loadingCron, setLoadingCron] = useState(false);
  const [savingCron, setSavingCron] = useState(false);

  const loadVersions = useCallback(async () => {
    if (!workflow) return;

    setLoadingVersions(true);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/versions`);
      if (!response.ok) throw new Error(`Failed to load versions: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setVersions(data.versions || []);
        // Find active version and set as default selected version
        const activeVersion = data.versions?.find((v: WorkflowVersion) => v.is_active);
        if (activeVersion) {
          setSelectedVersionNumber(activeVersion.version_number);
          if (activeVersion?.automation_sequence) {
            // Check if it's already a string or needs to be converted
            const yamlContent = typeof activeVersion.automation_sequence === 'string'
              ? activeVersion.automation_sequence
              : yaml.dump(activeVersion.automation_sequence);
            setCurrentYaml(yamlContent);
          }
        }
      } else {
        throw new Error(data.error || 'Failed to load versions');
      }
    } catch (error) {
      console.error('Error loading versions:', error);
      setErrorMessage(`Failed to load versions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingVersions(false);
    }
  }, [workflow]);

  const loadWorkflowYaml = useCallback(async () => {
    if (!workflow) return;

    setLoadingYaml(true);
    try {
      // Fetch YAML from GitHub (with database fallback for legacy workflows)
      const response = await fetch(`/api/remote-workflows/${workflow.id}/github-yaml`);

      if (!response.ok) {
        throw new Error(`Failed to fetch YAML: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.yaml) {
        console.log(`📄 Loaded YAML for workflow ${workflow.id} from:`, data.source);
        setCurrentYaml(data.yaml);
        setEditedYaml(data.yaml);
      } else {
        console.warn('No YAML content found for workflow');
        setCurrentYaml('');
      }
    } catch (error) {
      console.error('Error loading workflow YAML:', error);
      setCurrentYaml('');
    } finally {
      setLoadingYaml(false);
    }
  }, [workflow]);

  // Load YAML for a specific version
  const loadVersionYaml = useCallback(async (versionNumber: string) => {
    if (!workflow) return;

    setLoadingYaml(true);
    try {
      // Fetch YAML directly from GitHub (or database fallback)
      const response = await fetch(`/api/remote-workflows/${workflow.id}/github-yaml?version=${versionNumber}`);
      if (!response.ok) throw new Error(`Failed to load version: ${response.status}`);

      const data = await response.json();
      if (data.success && data.yaml) {
        setCurrentYaml(data.yaml);
        setEditedYaml(data.yaml);

        // Show source info
        if (data.source === 'github') {
          console.log(`✅ Loaded YAML from GitHub: ${data.github?.path}`);
        } else if (data.source === 'database_fallback') {
          console.warn('⚠️ Using cached version from database');
        }
      } else {
        setCurrentYaml('');
        setErrorMessage(`No YAML found for version ${versionNumber}`);
      }
    } catch (error) {
      console.error('Error loading version YAML:', error);
      setErrorMessage(`Failed to load version: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingYaml(false);
    }
  }, [workflow]);

  const loadMachines = useCallback(async () => {
    setLoadingMachines(true);
    try {
      const response = await fetch('/api/machines?status=active&include_load=true');
      if (!response.ok) throw new Error(`Failed to load machines: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setAvailableMachines(data.machines || []);
      } else {
        throw new Error(data.error || 'Failed to load machines');
      }
    } catch (error) {
      console.error('Error loading machines:', error);
      setErrorMessage(`Failed to load machines: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  const loadMachineAssignments = useCallback(async () => {
    if (!workflow) return;

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines`);
      if (!response.ok) throw new Error(`Failed to load machine assignments: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setMachineAssignments(data.assignments || []);
      } else {
        throw new Error(data.error || 'Failed to load machine assignments');
      }
    } catch (error) {
      console.error('Error loading machine assignments:', error);
      setErrorMessage(`Failed to load machine assignments: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [workflow]);

  // Load cron configuration
  const loadCronConfig = useCallback(async () => {
    if (!workflow) return;

    setLoadingCron(true);
    try {
      // First, try to load cron config from active version's YAML
      let cronConfigFromYaml: CronConfig | null = null;

      if (currentYaml) {
        try {
          const parsedYaml = yaml.load(currentYaml) as any;
          if (parsedYaml?.cron) {
            cronConfigFromYaml = {
              expression: parsedYaml.cron || '',
              timezone: parsedYaml.timezone || 'UTC',
              enabled: parsedYaml.cron_enabled !== false,
              maxConcurrent: parsedYaml.max_concurrent || 1,
              retryOnFailure: parsedYaml.retry_on_failure !== false,
              retryCount: parsedYaml.retry_count || 3,
            };
            console.log('✅ Loaded cron config from active version YAML');
          }
        } catch (yamlError) {
          console.warn('Failed to parse cron from YAML:', yamlError);
        }
      }

      // Fallback: Load from database if not found in YAML
      if (!cronConfigFromYaml) {
        const response = await fetch(`/api/remote-workflows/${workflow.id}/cron`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.cron_config) {
            cronConfigFromYaml = {
              expression: data.cron_config.cron_expression || '',
              timezone: data.cron_config.cron_timezone || 'UTC',
              enabled: data.cron_config.cron_enabled || false,
              maxConcurrent: data.cron_config.cron_max_concurrent || 1,
              retryOnFailure: data.cron_config.cron_retry_on_failure !== false,
              retryCount: data.cron_config.cron_retry_count || 3,
            };
            console.log('✅ Loaded cron config from database');
          }
        }
      }

      // Set the loaded config or defaults
      setCronConfig(cronConfigFromYaml || {
        expression: '',
        timezone: 'UTC',
        enabled: false,
        maxConcurrent: 1,
        retryOnFailure: true,
        retryCount: 3,
      });
    } catch (error) {
      console.error('Error loading cron config:', error);
    } finally {
      setLoadingCron(false);
    }
  }, [workflow, currentYaml]);

  // Save cron configuration
  const saveCronConfig = useCallback(async () => {
    if (!workflow || !cronConfig.expression) return;

    setSavingCron(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      // Step 1: Get active version YAML or current workflow YAML
      let yamlToUpdate = currentYaml;

      if (!yamlToUpdate) {
        // If no YAML loaded yet, fetch it
        const yamlResponse = await fetch(`/api/remote-workflows/${workflow.id}/github-yaml`);
        if (yamlResponse.ok) {
          const yamlData = await yamlResponse.json();
          yamlToUpdate = yamlData.yaml || '';
        }
      }

      if (!yamlToUpdate) {
        setErrorMessage('No workflow YAML found. Cannot update schedule.');
        return;
      }

      // Step 2: Parse YAML and update cron fields
      const parsedYaml = yaml.load(yamlToUpdate) as any;

      // Update cron fields in YAML
      parsedYaml.cron = cronConfig.expression;
      parsedYaml.timezone = cronConfig.timezone;
      parsedYaml.cron_enabled = cronConfig.enabled;
      parsedYaml.max_concurrent = cronConfig.maxConcurrent;
      parsedYaml.retry_on_failure = cronConfig.retryOnFailure;
      parsedYaml.retry_count = cronConfig.retryCount;

      const updatedYaml = yaml.dump(parsedYaml);

      // Step 3: Create new version with updated YAML
      const versionResponse = await fetch(`/api/remote-workflows/${workflow.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automation_sequence: updatedYaml,
          set_as_active: false, // Don't auto-activate
          change_notes: `Updated cron schedule: ${cronConfig.expression}`
        }),
      });

      const versionData = await versionResponse.json();

      if (!versionData.success) {
        setErrorMessage(versionData.error || 'Failed to create new version');
        return;
      }

      const newVersionNumber = versionData.version?.version_number;

      // Step 4: Update workflow-level cron config in database for scheduler
      const cronDbResponse = await fetch(`/api/remote-workflows/${workflow.id}/cron`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cron_expression: cronConfig.expression,
          cron_timezone: cronConfig.timezone,
          cron_enabled: cronConfig.enabled,
          cron_max_concurrent: cronConfig.maxConcurrent,
          cron_retry_on_failure: cronConfig.retryOnFailure,
          cron_retry_count: cronConfig.retryCount,
        }),
      });

      const cronDbData = await cronDbResponse.json();
      if (!cronDbData.success) {
        console.error('Failed to update database cron config:', cronDbData.error);
      }

      // Step 5: Ask user if they want to set this version as active
      const shouldActivate = window.confirm(
        `Schedule updated successfully! Created new version ${newVersionNumber}.\n\n` +
        `Would you like to set this version as ACTIVE?\n\n` +
        `(The cron schedule will run using the active version)`
      );

      if (shouldActivate) {
        // Activate the new version
        const activateResponse = await fetch(
          `/api/remote-workflows/${workflow.id}/activate/${newVersionNumber}`,
          { method: 'POST' }
        );

        const activateData = await activateResponse.json();
        if (activateData.success) {
          setSuccessMessage(`Schedule updated and version ${newVersionNumber} set as ACTIVE`);
          // Reload versions to show the new active version
          await loadVersions();
          if (onSettingsUpdated) onSettingsUpdated();
        } else {
          setErrorMessage(`Version created but failed to activate: ${activateData.error}`);
        }
      } else {
        setSuccessMessage(`Schedule updated! Created version ${newVersionNumber} (not active)`);
        // Reload versions to show the new version
        await loadVersions();
      }

    } catch (error) {
      console.error('Error saving cron config:', error);
      setErrorMessage(`Failed to save schedule: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSavingCron(false);
    }
  }, [workflow, cronConfig, currentYaml, loadVersions, onSettingsUpdated]);

  // Load data when modal opens
  useEffect(() => {
    if (open && workflow) {
      loadVersions();
      loadMachines();
      loadMachineAssignments();
      loadWorkflowYaml();
      loadCronConfig();
      setEditedName(workflow.name || '');
      setEditedDescription(workflow.description || '');
    }
  }, [open, workflow, loadVersions, loadMachineAssignments, loadMachines, loadWorkflowYaml, loadCronConfig]);

  // Clear messages after 3 seconds
  useEffect(() => {
    if (successMessage || errorMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage('');
        setErrorMessage('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage, errorMessage]);


  const saveNameAndDescription = async () => {
    if (!workflow) return;

    setSavingNameDescription(true);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editedName,
          description: editedDescription
        })
      });

      if (!response.ok) throw new Error(`Failed to update workflow: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setSuccessMessage('Workflow updated successfully');
        setIsEditingName(false);
        setIsEditingDescription(false);
        onSettingsUpdated?.();
      } else {
        throw new Error(data.error || 'Failed to update workflow');
      }
    } catch (error) {
      console.error('Error updating workflow:', error);
      setErrorMessage(`Failed to update workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSavingNameDescription(false);
    }
  };

  const activateVersion = async (versionNumber: string) => {
    if (!workflow) return;

    setActivatingVersion(versionNumber);
    try {
      const response = await fetch(`/api/remote-workflows/${workflow.id}/activate/${versionNumber}`, {
        method: 'POST'
      });

      if (!response.ok) throw new Error(`Failed to activate version: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`Version ${versionNumber} activated successfully`);
        await loadVersions();
        onSettingsUpdated?.();
      } else {
        throw new Error(data.error || 'Failed to activate version');
      }
    } catch (error) {
      console.error('Error activating version:', error);
      setErrorMessage(`Failed to activate version: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setActivatingVersion(null);
    }
  };

  const addMachineAssignment = async () => {
    if (!workflow || !selectedMachineId) return;

    setAddingAssignment(true);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_assignments: [
            {
              machine_id: parseInt(selectedMachineId),
              assignment_type: selectedAssignmentType,
              priority: machineAssignments.length + 1,
              conditions: {},
              reason: 'Assigned via UI'
            }
          ]
        })
      });

      if (!response.ok) throw new Error(`Failed to add machine assignment: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`Machine assignment added successfully`);
        setSelectedMachineId('');
        await loadMachineAssignments();
        onSettingsUpdated?.();
      } else {
        throw new Error(data.error || 'Failed to add machine assignment');
      }
    } catch (error) {
      console.error('Error adding machine assignment:', error);
      setErrorMessage(`Failed to add machine assignment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setAddingAssignment(false);
    }
  };

  const removeMachineAssignment = async (assignmentId: number) => {
    if (!workflow) return;

    setRemovingAssignment(assignmentId);
    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines?assignment_id=${assignmentId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) throw new Error(`Failed to remove machine assignment: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setSuccessMessage(`Machine assignment removed successfully`);
        await loadMachineAssignments();
        onSettingsUpdated?.();
      } else {
        throw new Error(data.error || 'Failed to remove machine assignment');
      }
    } catch (error) {
      console.error('Error removing machine assignment:', error);
      setErrorMessage(`Failed to remove machine assignment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRemovingAssignment(null);
    }
  };

  const getActiveVersion = () => versions.find(v => v.is_active);
  const getAvailableMachinesForAssignment = () => {
    const assignedMachineIds = machineAssignments.map(a => a.machine_id);
    return availableMachines.filter(m => !assignedMachineIds.includes(m.id));
  };

  if (!workflow) return null;

  // Check if workflow has detailed info (is WorkflowOverview)
  const hasDetailedInfo = 'input_parameters' in workflow;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto !mt-8 !mb-8 !top-8 !transform-none !translate-y-0">
        <DialogHeader>
          {/* Inline Editable Title */}
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <>
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onBlur={() => {
                    if (editedName !== workflow.name) {
                      saveNameAndDescription();
                    } else {
                      setIsEditingName(false);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      saveNameAndDescription();
                    } else if (e.key === 'Escape') {
                      setEditedName(workflow.name);
                      setIsEditingName(false);
                    }
                  }}
                  className="text-2xl font-bold border-2 border-black"
                  autoFocus
                  disabled={savingNameDescription}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => saveNameAndDescription()}
                  disabled={savingNameDescription}
                  className="flex-shrink-0"
                >
                  {savingNameDescription ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEditedName(workflow.name);
                    setIsEditingName(false);
                  }}
                  disabled={savingNameDescription}
                  className="flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </>
            ) : (
              <DialogTitle
                className="text-2xl cursor-pointer hover:bg-gray-50 px-2 py-1 rounded transition-colors flex-1"
                onClick={() => setIsEditingName(true)}
              >
                {workflow.name}
              </DialogTitle>
            )}
          </div>

          {/* Inline Editable Description */}
          {isEditingDescription ? (
            <div className="flex items-start gap-2">
              <Textarea
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                onBlur={() => {
                  if (editedDescription !== workflow.description) {
                    saveNameAndDescription();
                  } else {
                    setIsEditingDescription(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditedDescription(workflow.description || '');
                    setIsEditingDescription(false);
                  }
                }}
                className="border-2 border-black resize-none"
                rows={2}
                autoFocus
                disabled={savingNameDescription}
              />
              <div className="flex flex-col gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => saveNameAndDescription()}
                  disabled={savingNameDescription}
                  className="flex-shrink-0"
                >
                  {savingNameDescription ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEditedDescription(workflow.description || '');
                    setIsEditingDescription(false);
                  }}
                  disabled={savingNameDescription}
                  className="flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <DialogDescription
              className="cursor-pointer hover:bg-gray-50 px-2 py-1 rounded transition-colors"
              onClick={() => setIsEditingDescription(true)}
            >
              {workflow.description || 'Click to add description'}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-black rounded-lg">
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-green-800">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-black rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-red-800">{errorMessage}</span>
          </div>
        )}

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="workflow">Workflow</TabsTrigger>
            <TabsTrigger value="parameters">Parameters</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="versions">Versions</TabsTrigger>
            <TabsTrigger value="machines">Machines</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="font-semibold mb-2">Metadata</h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Active Version:</dt>
                    <dd className="font-mono">v{getActiveVersion()?.version_number || workflow.version}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Category:</dt>
                    <dd className="font-mono">{workflow.category}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Est. Duration:</dt>
                    <dd className="font-mono">{formatDuration(workflow.estimated_duration_seconds)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Timeout:</dt>
                    <dd className="font-mono">{workflow.timeout_minutes || 25} minutes</dd>
                  </div>
                </dl>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Performance</h4>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Total Runs:</dt>
                    <dd className="font-mono">{workflow.total_executions || 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Success Rate:</dt>
                    <dd className="font-mono">
                      {workflow.success_rate !== null
                        ? `${workflow.success_rate}%`
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Successful:</dt>
                    <dd className="font-mono">{workflow.successful_runs || 0}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="workflow" className="space-y-4">
            {/* Version Selector */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 border-2 border-black rounded-lg">
              <span className="font-mono font-bold text-sm uppercase">Version:</span>
              <Select
                value={selectedVersionNumber}
                onValueChange={(value) => {
                  setSelectedVersionNumber(value);
                  loadVersionYaml(value);
                  setIsEditingYaml(false);
                  setUploadResult(null);
                }}
                disabled={loadingVersions || isEditingYaml}
              >
                <SelectTrigger className="w-[200px] border-2 border-black font-mono">
                  <SelectValue placeholder="Select version" />
                </SelectTrigger>
                <SelectContent>
                  {versions
                    .sort((a, b) => {
                      // Sort by version number descending (latest first)
                      const aNum = parseFloat(a.version_number);
                      const bNum = parseFloat(b.version_number);
                      return bNum - aNum;
                    })
                    .map((version) => (
                      <SelectItem key={version.version_number} value={version.version_number}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">v{version.version_number}</span>
                          {version.is_active && (
                            <Badge className="bg-black text-white text-xs">ACTIVE</Badge>
                          )}
                          <span className="text-xs text-gray-500">
                            {version.execution_count} runs
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {versions.find(v => v.version_number === selectedVersionNumber)?.is_active && (
                <Badge className="bg-black text-white animate-pulse">
                  <Star className="w-3 h-3 mr-1" />
                  Active Version
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold flex items-center gap-2">
                <FileCode className="w-4 h-4" />
                {isEditingYaml ? 'Edit Workflow YAML' : 'Current Workflow YAML'}
              </h4>
              <div className="flex gap-2">
                {!isEditingYaml ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingYaml(true);
                        setEditedYaml(currentYaml);
                        setUploadResult(null);
                      }}
                      disabled={!currentYaml}
                      className="flex items-center gap-1"
                    >
                      <Edit className="w-3 h-3" />
                      Edit YAML
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (currentYaml && onUseAsTemplate) {
                          onUseAsTemplate(currentYaml, workflow.name);
                          onOpenChange(false);
                        }
                      }}
                      disabled={!currentYaml || !onUseAsTemplate}
                      className="flex items-center gap-1"
                    >
                      <FilePlus className="w-3 h-3" />
                      Use as Template
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(currentYaml);
                        setSuccessMessage('YAML copied to clipboard');
                      }}
                      disabled={!currentYaml}
                    >
                      Copy YAML
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setIsEditingYaml(false);
                        setEditedYaml(currentYaml);
                        setUploadResult(null);
                      }}
                      className="flex items-center gap-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={async () => {
                        setUploadingVersion(true);
                        setUploadResult(null);
                        try {
                          // Upload new version
                          const response = await fetch(`/api/remote-workflows/${workflow.id}/versions`, {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              automation_sequence: editedYaml,
                              set_as_active: false,
                              change_notes: 'Updated via workflow editor'
                            }),
                          });

                          if (!response.ok) {
                            const errorData = await response.json();
                            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
                          }

                          const result = await response.json();
                          setUploadResult({
                            success: true,
                            message: `Successfully uploaded version ${result.version.version_number}`
                          });

                          // Reload versions and reset state after successful upload
                          await loadVersions();
                          setTimeout(() => {
                            setIsEditingYaml(false);
                            setCurrentYaml(editedYaml);
                            setUploadResult(null);
                          }, 2000);
                        } catch (error) {
                          console.error('Version upload failed:', error);
                          setUploadResult({
                            success: false,
                            message: error instanceof Error ? error.message : 'Upload failed'
                          });
                        } finally {
                          setUploadingVersion(false);
                        }
                      }}
                      disabled={uploadingVersion || editedYaml === currentYaml}
                      className="flex items-center gap-1"
                    >
                      {uploadingVersion ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="w-3 h-3" />
                          Upload as New Version
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {uploadResult && (
              <Alert className={uploadResult.success ? 'border-green-500' : 'border-red-500'}>
                {uploadResult.success ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-500" />
                )}
                <AlertDescription>
                  {uploadResult.message}
                </AlertDescription>
              </Alert>
            )}

            {loadingYaml ? (
              <div className="flex items-center gap-2 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading workflow YAML...</span>
              </div>
            ) : currentYaml ? (
              <div className="w-full">
                <YamlEditorWithHighlight
                  value={isEditingYaml ? editedYaml : currentYaml}
                  onChange={(value) => setEditedYaml(value)}
                  readOnly={!isEditingYaml}
                  minHeight="500px"
                  className="w-full"
                />
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No workflow YAML available for this workflow.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="schedule" className="space-y-4">
            <Card className="border-2 border-black">
              <CardHeader className="bg-black text-white">
                <CardTitle className="font-mono flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  CRON SCHEDULE CONFIGURATION
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {loadingCron ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="ml-2">Loading schedule configuration...</span>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <CronScheduleEditor
                      cronExpression={cronConfig.expression}
                      cronTimezone={cronConfig.timezone}
                      cronEnabled={cronConfig.enabled}
                      cronMaxConcurrent={cronConfig.maxConcurrent}
                      cronRetryOnFailure={cronConfig.retryOnFailure}
                      cronRetryCount={cronConfig.retryCount}
                      onChange={setCronConfig}
                      showAdvanced={true}
                    />

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => loadCronConfig()}
                        disabled={savingCron}
                        className="border-2 border-black hover:bg-black hover:text-white"
                      >
                        Reset
                      </Button>
                      <Button
                        onClick={saveCronConfig}
                        disabled={savingCron || !cronConfig.expression}
                        className="bg-black text-white hover:bg-gray-800"
                      >
                        {savingCron ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4 mr-2" />
                            Save Schedule
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="parameters" className="space-y-4">
            {hasDetailedInfo ? (
              <>
                <div>
                  <h4 className="font-semibold mb-3">Input Parameters</h4>
                  {Object.keys(workflow.input_parameters).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(workflow.input_parameters).map(([key, param]: [string, any]) => (
                        <div key={key} className="border border-black rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <code className="text-sm font-mono">{key}</code>
                            <Badge variant="secondary" className="text-xs">
                              {param?.type || 'string'}
                            </Badge>
                          </div>
                          {param?.description && (
                            <p className="text-sm text-muted-foreground">{param.description}</p>
                          )}
                          {param?.required && (
                            <Badge variant="destructive" className="text-xs mt-1">Required</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No input parameters required</p>
                  )}
                </div>

                <Separator />

                <div>
                  <JsonBlock
                    data={workflow.sample_inputs}
                    title="Sample Input"
                    theme="light"
                    size="sm"
                  />
                </div>

                <div>
                  <JsonBlock
                    data={workflow.expected_outputs}
                    title="Expected Outputs"
                    theme="light"
                    size="sm"
                  />
                </div>
              </>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Parameter details are not available for this workflow.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="versions" className="space-y-4">
            <Card className="border-black-outline">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  Version Management
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingVersions ? (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading versions...</span>
                  </div>
                ) : versions.length === 0 ? (
                  <p className="text-muted-foreground py-4">No versions found for this workflow.</p>
                ) : (
                  <div className="space-y-2">
                    {/* Active Version */}
                    {getActiveVersion() && (
                      <div className="p-2 bg-black text-white rounded border border-black">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Star className="w-3.5 h-3.5" />
                            <span className="font-medium">v{getActiveVersion()!.version_number}</span>
                          </div>
                          <span className="text-sm">{getActiveVersion()!.execution_count} executions</span>
                        </div>
                      </div>
                    )}

                    {/* Other Versions */}
                    <div className="space-y-1">
                      {versions
                        .filter(v => !v.is_active)
                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                        .slice(0, 8)
                        .map((version) => (
                          <div key={version.version_number} className="flex items-center justify-between p-2 border border-black rounded text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">v{version.version_number}</span>
                              <span className="text-muted-foreground">{version.execution_count} exec</span>
                              <span className="text-muted-foreground">
                                {new Date(version.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                            <Button
                              variant="black-outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => activateVersion(version.version_number)}
                              disabled={activatingVersion === version.version_number}
                            >
                              {activatingVersion === version.version_number ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                'Activate'
                              )}
                            </Button>
                          </div>
                        ))}
                      {versions.filter(v => !v.is_active).length > 8 && (
                        <div className="text-center text-sm text-muted-foreground pt-1">
                          +{versions.filter(v => !v.is_active).length - 8} more versions
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="machines" className="space-y-4">
            <Card className="border-black-outline">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Monitor className="w-5 h-5" />
                  Machine Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Current Assignments */}
                {machineAssignments.length > 0 && (
                  <div className="space-y-1">
                    <h4 className="font-medium text-sm">Current Assignments</h4>
                    {machineAssignments
                      .sort((a, b) => a.priority - b.priority)
                      .map((assignment) => {
                        // Find the machine data for this assignment
                        const machineData = availableMachines.find(m => m.id === assignment.machine_id);

                        return (
                          <div key={assignment.assignment_id} className="flex items-center justify-between p-2 border border-black rounded text-sm">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate" title={assignment.machine_name}>{assignment.machine_name}</span>
                              {/* Health indicator for assigned machines */}
                              {machineData && (
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  machineData.health_status === 'healthy' ? 'bg-black animate-pulse' :
                                  machineData.health_status === 'unhealthy' ? 'bg-gray-800' :
                                  'bg-gray-400'
                                }`} title={`Health: ${machineData.health_status || 'unknown'}`} />
                              )}
                              <Badge className={assignment.assignment_type === 'exclusive'
                                ? 'bg-black text-white border border-black text-xs flex-shrink-0'
                                : 'bg-white text-black border border-black text-xs flex-shrink-0'
                              }>
                                {assignment.assignment_type}
                              </Badge>
                            </div>
                            <Button
                              variant="black-outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() => removeMachineAssignment(assignment.assignment_id)}
                              disabled={removingAssignment === assignment.assignment_id}
                            >
                              {removingAssignment === assignment.assignment_id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Trash2 className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Add Assignment */}
                {getAvailableMachinesForAssignment().length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-black">
                    <h4 className="font-medium text-sm">Add Assignment</h4>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <Select value={selectedMachineId} onValueChange={setSelectedMachineId}>
                        <SelectTrigger className="border-black-outline h-8 text-sm">
                          <SelectValue placeholder="Select machine" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableMachinesForAssignment().map((machine) => {
                            // Parse health details for tooltip with uptime
                            let healthTooltip = '';

                            // Format uptime
                            const formatUptime = (uptimeSeconds: number | null | undefined): string => {
                              if (!uptimeSeconds || uptimeSeconds <= 0) return 'N/A';
                              const days = Math.floor(uptimeSeconds / 86400);
                              const hours = Math.floor((uptimeSeconds % 86400) / 3600);
                              const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                              if (days > 0) return `${days}d ${hours}h`;
                              if (hours > 0) return `${hours}h ${minutes}m`;
                              return `${minutes}m`;
                            };

                            if (machine.health_details) {
                              try {
                                const details = typeof machine.health_details === 'string'
                                  ? JSON.parse(machine.health_details)
                                  : machine.health_details;

                                healthTooltip = `Health: ${machine.health_status || 'unknown'}\n`;

                                // Add uptime if available
                                if ((machine as any).uptime_seconds) {
                                  healthTooltip += `Uptime: ${formatUptime((machine as any).uptime_seconds)}\n`;
                                }

                                if (details.lastCheck) {
                                  const lastCheck = new Date(details.lastCheck);
                                  const timeAgo = Math.floor((Date.now() - lastCheck.getTime()) / 1000);
                                  const timeStr = timeAgo < 60 ? `${timeAgo}s ago`
                                    : timeAgo < 3600 ? `${Math.floor(timeAgo / 60)}m ago`
                                    : `${Math.floor(timeAgo / 3600)}h ago`;
                                  healthTooltip += `Last check: ${timeStr}\n`;

                                  if (details.responseTime) {
                                    healthTooltip += `Response: ${details.responseTime}ms\n`;
                                  }
                                  if (details.error) {
                                    healthTooltip += `Error: ${details.error}\n`;
                                  }
                                }
                              } catch (e) {
                                // If parsing fails, show basic info
                                healthTooltip = `Health: ${machine.health_status || 'unknown'}`;
                                if ((machine as any).uptime_seconds) {
                                  healthTooltip += `\nUptime: ${formatUptime((machine as any).uptime_seconds)}`;
                                }
                              }
                            } else {
                              healthTooltip = `Health: ${machine.health_status || 'unknown'}`;
                              if ((machine as any).uptime_seconds) {
                                healthTooltip += `\nUptime: ${formatUptime((machine as any).uptime_seconds)}`;
                              }
                            }

                            return (
                              <SelectItem key={machine.id} value={machine.id.toString()}>
                                <div className="flex items-center gap-2 max-w-[300px]" title={healthTooltip}>
                                  <span className="truncate" title={`${machine.name}\n${healthTooltip}`}>
                                    {machine.name}
                                  </span>
                                  {/* Health indicator dot */}
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    machine.health_status === 'healthy' ? 'bg-black animate-pulse' :
                                    machine.health_status === 'unhealthy' ? 'bg-gray-800' :
                                    'bg-gray-400'
                                  }`} />
                                  {machine.current_load !== undefined && machine.max_concurrent && (
                                    <span className="text-xs text-muted-foreground flex-shrink-0">
                                      ({machine.current_load}/{machine.max_concurrent})
                                    </span>
                                  )}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>

                      <Select value={selectedAssignmentType} onValueChange={(value: 'exclusive' | 'preferred') => setSelectedAssignmentType(value)}>
                        <SelectTrigger className="border-black-outline h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="preferred">Preferred</SelectItem>
                          <SelectItem value="exclusive">Exclusive</SelectItem>
                        </SelectContent>
                      </Select>

                      <Button
                        variant="black-outline"
                        className="h-8 text-xs"
                        onClick={addMachineAssignment}
                        disabled={!selectedMachineId || addingAssignment}
                      >
                        {addingAssignment ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          'Add'
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Loading state */}
                {loadingMachines && (
                  <div className="flex items-center gap-2 py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading machines...</span>
                  </div>
                )}

                {/* No machines available */}
                {!loadingMachines && availableMachines.length === 0 && (
                  <p className="text-muted-foreground py-4">No machines available for assignment.</p>
                )}

                {/* All machines assigned */}
                {!loadingMachines && getAvailableMachinesForAssignment().length === 0 && availableMachines.length > 0 && (
                  <p className="text-muted-foreground py-4">All available machines are already assigned to this workflow.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="usage" className="space-y-4">
            <Alert>
              <Terminal className="h-4 w-4" />
              <AlertDescription>
                Execute this workflow by making a POST request to the execution endpoint
              </AlertDescription>
            </Alert>

            <div>
              <CodeBlock
                language="curl"
                title="cURL Example"
                size="sm"
              >
{`curl -X POST \\
https://app.mediar.ai/api/remote-workflows/${workflow.id}/execute \\
-H "Content-Type: application/json" \\
-d '${JSON.stringify(hasDetailedInfo ? workflow.sample_inputs : {}, null, 2)}'`}
              </CodeBlock>
            </div>

            <div>
              <CodeBlock
                language="javascript"
                title="JavaScript Example"
                size="sm"
              >
{`fetch('/api/remote-workflows/${workflow.id}/execute', {
method: 'POST',
headers: { 'Content-Type': 'application/json' },
body: JSON.stringify(${JSON.stringify(hasDetailedInfo ? workflow.sample_inputs : {}, null, 2)})
}).then(response => response.json())`}
              </CodeBlock>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}