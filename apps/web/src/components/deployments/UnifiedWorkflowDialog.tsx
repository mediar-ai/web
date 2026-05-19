'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Terminal,
  Package,
  Monitor,
  Star,
  Trash2,
  Loader2,
  Check,
  AlertCircle,
  FileCode,
  Save,
  X,
  Clock,
  BarChart3,
  Workflow,
  GitBranch,
  Server,
  Activity,
  FileInput,
} from 'lucide-react';
import { CodeBlock, JsonBlock } from '@/components/ui/code-block';
import { formatDuration } from './utils';
import { YamlEditorWithHighlight } from '@/components/YamlEditorWithHighlight';
import { CronScheduleEditor, type CronConfig } from './CronScheduleEditor';
import { TypeScriptWorkflowTab } from './TypeScriptWorkflowTab';

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
  assignment_type: 'exclusive';
  priority: number;
  machine_name: string;
}

interface UnifiedWorkflowDialogProps {
  workflow: any | null; // Accept any workflow type since we handle both
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsUpdated?: () => void;
  isMediarTeam?: boolean; // Show executor selection for superadmins
}

export function UnifiedWorkflowDialog({
  workflow,
  open,
  onOpenChange,
  onSettingsUpdated,
  isMediarTeam = false,
}: UnifiedWorkflowDialogProps) {
  // Version management state
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [activatingVersion, setActivatingVersion] = useState<string | null>(
    null
  );
  const [currentYaml, setCurrentYaml] = useState<string>('');
  const [loadingYaml, setLoadingYaml] = useState(false);
  const [selectedVersionNumber, setSelectedVersionNumber] =
    useState<string>(''); // Track selected version for viewing

  // Inline editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [savingNameDescription, setSavingNameDescription] = useState(false);

  // Tags state
  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);

  // Machine assignment state
  const [availableMachines, setAvailableMachines] = useState<Machine[]>([]);
  const [machineAssignments, setMachineAssignments] = useState<
    MachineAssignment[]
  >([]);
  const [loadingMachines, setLoadingMachines] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [addingAssignment, setAddingAssignment] = useState(false);
  const [removingAssignment, setRemovingAssignment] = useState<number | null>(
    null
  );

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

  // Load YAML for a specific version (defined before loadVersions to avoid circular dependency)
  const loadVersionYaml = useCallback(
    async (versionNumber: string) => {
      if (!workflow) return;

      // Skip YAML loading for TypeScript workflows
      if (workflow.preferred_format === 'typescript') {
        setCurrentYaml('');
        setLoadingYaml(false);
        return;
      }

      setLoadingYaml(true);
      try {
        // Fetch YAML directly from GitHub (or database fallback)
        const response = await fetch(
          `/api/remote-workflows/${workflow.id}/github-yaml?version=${versionNumber}`
        );
        if (!response.ok)
          throw new Error(`Failed to load version: ${response.status}`);

        const data = await response.json();
        if (data.success && data.yaml) {
          setCurrentYaml(data.yaml);

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
        setErrorMessage(
          `Failed to load version: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } finally {
        setLoadingYaml(false);
      }
    },
    [workflow]
  );

  const loadVersions = useCallback(async () => {
    if (!workflow) return;

    setLoadingVersions(true);
    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/versions`
      );
      if (!response.ok)
        throw new Error(`Failed to load versions: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setVersions(data.versions || []);
        // Find active version and set as default selected version
        const activeVersion = data.versions?.find(
          (v: WorkflowVersion) => v.is_active
        );
        if (activeVersion) {
          setSelectedVersionNumber(activeVersion.version_number);
          // Load the active version's YAML from GitHub/database
          loadVersionYaml(activeVersion.version_number);
        }
      } else {
        throw new Error(data.error || 'Failed to load versions');
      }
    } catch (error) {
      console.error('Error loading versions:', error);
      setErrorMessage(
        `Failed to load versions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoadingVersions(false);
    }
  }, [workflow, loadVersionYaml]);

  // YAML editing feature currently disabled - moved to separate page
  const _loadWorkflowYaml = useCallback(async () => {
    if (!workflow) return;

    setLoadingYaml(true);
    try {
      // Fetch YAML from GitHub (with database fallback for legacy workflows)
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/github-yaml`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch YAML: ${response.status}`);
      }

      const data = await response.json();

      if (data.success && data.yaml) {
        console.log(
          `📄 Loaded YAML for workflow ${workflow.id} from:`,
          data.source
        );
        setCurrentYaml(data.yaml);
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

  const loadMachines = useCallback(async () => {
    setLoadingMachines(true);
    try {
      const response = await fetch(
        '/api/machines?status=active&include_load=true'
      );
      if (!response.ok)
        throw new Error(`Failed to load machines: ${response.status}`);

      const data = await response.json();
      if (data.success) {
        setAvailableMachines(data.machines || []);
      } else {
        throw new Error(data.error || 'Failed to load machines');
      }
    } catch (error) {
      console.error('Error loading machines:', error);
      setErrorMessage(
        `Failed to load machines: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoadingMachines(false);
    }
  }, []);

  const loadMachineAssignments = useCallback(async () => {
    if (!workflow) return;

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/machines`);
      if (!response.ok)
        throw new Error(
          `Failed to load machine assignments: ${response.status}`
        );

      const data = await response.json();
      if (data.success) {
        setMachineAssignments(data.assignments || []);
      } else {
        throw new Error(data.error || 'Failed to load machine assignments');
      }
    } catch (error) {
      console.error('Error loading machine assignments:', error);
      setErrorMessage(
        `Failed to load machine assignments: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }, [workflow]);

  // Load cron configuration from database (single source of truth)
  const loadCronConfig = useCallback(async () => {
    if (!workflow) return;

    setLoadingCron(true);
    try {
      // Load cron config directly from database
      const response = await fetch(`/api/remote-workflows/${workflow.id}/cron`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.cron_config) {
          setCronConfig({
            expression: data.cron_config.cron_expression || '',
            timezone: data.cron_config.cron_timezone || 'UTC',
            enabled: data.cron_config.cron_enabled || false,
            maxConcurrent: data.cron_config.cron_max_concurrent || 1,
            retryOnFailure: data.cron_config.cron_retry_on_failure !== false,
            retryCount: data.cron_config.cron_retry_count || 3,
            executorType: data.cron_config.cron_executor_type || 'python',
          });
          console.log('✅ Loaded cron config from database');
        } else {
          // No cron config exists yet, use defaults
          setCronConfig({
            expression: '',
            timezone: 'UTC',
            enabled: false,
            maxConcurrent: 1,
            retryOnFailure: true,
            retryCount: 3,
            executorType: 'python',
          });
        }
      } else {
        // API error, use defaults
        setCronConfig({
          expression: '',
          timezone: 'UTC',
          enabled: false,
          maxConcurrent: 1,
          retryOnFailure: true,
          retryCount: 3,
        });
      }
    } catch (error) {
      console.error('Error loading cron config:', error);
      // On error, use defaults
      setCronConfig({
        expression: '',
        timezone: 'UTC',
        enabled: false,
        maxConcurrent: 1,
        retryOnFailure: true,
        retryCount: 3,
      });
    } finally {
      setLoadingCron(false);
    }
  }, [workflow]);

  // Save cron configuration
  const saveCronConfig = useCallback(async () => {
    if (!workflow || !cronConfig.expression) return;

    setSavingCron(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      console.log('📅 Saving cron config to database:', {
        cron: cronConfig.expression,
        timezone: cronConfig.timezone,
        enabled: cronConfig.enabled,
      });

      // Update workflow-level cron config in database (single source of truth)
      const cronDbResponse = await fetch(
        `/api/remote-workflows/${workflow.id}/cron`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cron_expression: cronConfig.expression,
            cron_timezone: cronConfig.timezone,
            cron_enabled: cronConfig.enabled,
            cron_max_concurrent: cronConfig.maxConcurrent,
            cron_retry_on_failure: cronConfig.retryOnFailure,
            cron_executor_type: cronConfig.executorType || 'python',
            cron_retry_count: cronConfig.retryCount,
          }),
        }
      );

      const cronDbData = await cronDbResponse.json();

      if (!cronDbData.success) {
        throw new Error(cronDbData.error || 'Failed to update cron config');
      }

      setSuccessMessage('Schedule updated successfully!');

      if (onSettingsUpdated) {
        onSettingsUpdated();
      }
    } catch (error) {
      console.error('Error saving cron config:', error);
      setErrorMessage(
        `Failed to save schedule: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setSavingCron(false);
    }
  }, [workflow, cronConfig, onSettingsUpdated]);

  // Load data when modal opens
  useEffect(() => {
    if (open && workflow) {
      loadVersions(); // This already loads the active version's YAML
      loadMachines();
      loadMachineAssignments();
      // Don't call loadWorkflowYaml() here - it would overwrite the active version YAML with latest
      loadCronConfig();
      setEditedName(workflow.name || '');
      setEditedDescription(workflow.description || '');
      setTags(workflow.tags || []);
    }
  }, [
    open,
    workflow,
    loadVersions,
    loadMachineAssignments,
    loadMachines,
    loadCronConfig,
  ]);

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
          description: editedDescription,
        }),
      });

      if (!response.ok)
        throw new Error(`Failed to update workflow: ${response.status}`);

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
      setErrorMessage(
        `Failed to update workflow: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setSavingNameDescription(false);
    }
  };

  // Tag management functions
  const addTag = async (tag: string) => {
    const trimmedTag = tag.trim().toLowerCase();
    if (!trimmedTag || tags.includes(trimmedTag) || !workflow) return;

    const newTags = [...tags, trimmedTag];
    setTags(newTags);
    setNewTagInput('');
    await saveTags(newTags);
  };

  const removeTag = async (tagToRemove: string) => {
    if (!workflow) return;
    const newTags = tags.filter(t => t !== tagToRemove);
    setTags(newTags);
    await saveTags(newTags);
  };

  const saveTags = async (newTags: string[]) => {
    if (!workflow?.id) {
      console.error('Cannot save tags: workflow.id is undefined');
      return;
    }
    setSavingTags(true);
    try {
      console.log(`Saving tags for workflow ${workflow.id}:`, newTags);
      const response = await fetch(`/api/remote-workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      });

      const data = await response.json();
      console.log('Save tags response:', response.status, data);

      if (!response.ok) {
        throw new Error(
          `Failed to update tags: ${response.status} - ${data.error || 'Unknown error'}`
        );
      }

      if (data.success) {
        onSettingsUpdated?.();
      } else {
        throw new Error(data.error || 'Failed to update tags');
      }
    } catch (error) {
      console.error('Error updating tags:', error);
      setErrorMessage(
        `Failed to update tags: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // Revert on error
      setTags(workflow.tags || []);
    } finally {
      setSavingTags(false);
    }
  };

  const activateVersion = async (versionNumber: string) => {
    if (!workflow) return;

    setActivatingVersion(versionNumber);
    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/activate/${versionNumber}`,
        {
          method: 'POST',
        }
      );

      if (!response.ok)
        throw new Error(`Failed to activate version: ${response.status}`);

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
      setErrorMessage(
        `Failed to activate version: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
              assignment_type: 'exclusive',
              priority: machineAssignments.length + 1,
              conditions: {},
              reason: 'Assigned via UI',
            },
          ],
        }),
      });

      if (!response.ok)
        throw new Error(`Failed to add machine assignment: ${response.status}`);

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
      setErrorMessage(
        `Failed to add machine assignment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setAddingAssignment(false);
    }
  };

  const removeMachineAssignment = async (assignmentId: number) => {
    if (!workflow) return;

    setRemovingAssignment(assignmentId);
    try {
      const response = await fetch(
        `/api/workflows/${workflow.id}/machines?assignment_id=${assignmentId}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok)
        throw new Error(
          `Failed to remove machine assignment: ${response.status}`
        );

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
      setErrorMessage(
        `Failed to remove machine assignment: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
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
  const isTypescript =
    workflow.preferred_format === 'typescript' ||
    !!workflow.typescript_metadata;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl h-[85vh] flex flex-col border-2 border-black p-0 overflow-hidden"
        hideClose
      >
        <DialogHeader>
          {/* Inline Editable Title */}
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <Input
                value={editedName}
                onChange={e => setEditedName(e.target.value)}
                onBlur={() => {
                  if (editedName !== workflow.name) {
                    saveNameAndDescription();
                  } else {
                    setIsEditingName(false);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    saveNameAndDescription();
                  } else if (e.key === 'Escape') {
                    setEditedName(workflow.name || '');
                    setIsEditingName(false);
                  }
                }}
                autoFocus
                className="text-2xl font-bold border-2 border-gray-300 rounded-lg focus:border-blue-500"
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
            </div>
          ) : (
            <DialogTitle
              className="text-2xl cursor-pointer hover:bg-gray-50 px-2 py-1 rounded transition-colors"
              onClick={() => setIsEditingName(true)}
            >
              {editedName || workflow.name}
            </DialogTitle>
          )}

          {/* Inline Editable Description */}
          {isEditingDescription ? (
            <div className="flex items-start gap-2">
              <Textarea
                value={editedDescription}
                onChange={e => setEditedDescription(e.target.value)}
                onBlur={() => {
                  if (editedDescription !== workflow.description) {
                    saveNameAndDescription();
                  } else {
                    setIsEditingDescription(false);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    setEditedDescription(workflow.description || '');
                    setIsEditingDescription(false);
                  }
                }}
                autoFocus
                rows={3}
                className="flex-1 border-2 border-gray-300 rounded-lg focus:border-blue-500"
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
              className="cursor-pointer hover:bg-gray-100 px-3 py-2 rounded-lg transition-colors text-gray-600"
              onClick={() => setIsEditingDescription(true)}
            >
              {workflow.description || 'Click to add description'}
            </DialogDescription>
          )}

          {/* Tags - Notion style */}
          <div className="flex items-center gap-2 mt-3 flex-wrap px-3">
            {tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-mono rounded transition-colors group"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="opacity-0 group-hover:opacity-100 hover:text-black transition-opacity"
                  disabled={savingTags}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag(newTagInput);
                } else if (
                  e.key === 'Backspace' &&
                  !newTagInput &&
                  tags.length > 0
                ) {
                  removeTag(tags[tags.length - 1]);
                }
              }}
              placeholder={tags.length === 0 ? 'Add tags...' : '+'}
              className="px-2 py-0.5 text-xs font-mono bg-transparent border-none outline-none min-w-16 placeholder:text-gray-400"
              disabled={savingTags}
            />
            {savingTags && (
              <Loader2 className="w-3 h-3 animate-spin text-gray-400" />
            )}
          </div>
        </DialogHeader>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="flex items-center gap-2 p-4 mx-8 mt-4 bg-white border-2 border-black rounded-lg">
            <Check className="w-4 h-4" />
            <span className="font-medium">{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-4 mx-8 mt-4 bg-white border-2 border-black rounded-lg">
            <AlertCircle className="w-4 h-4" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        <Tabs
          defaultValue="overview"
          className="mt-2 flex-1 flex flex-col overflow-hidden"
        >
          <TabsList className="flex w-full justify-center px-6 py-3 bg-transparent gap-2 h-auto overflow-x-auto border-0">
            <TabsTrigger
              value="overview"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="workflow"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <Workflow className="w-4 h-4 mr-2" />
              Workflow
            </TabsTrigger>
            <TabsTrigger
              value="parameters"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <FileInput className="w-4 h-4 mr-2" />
              Inputs
            </TabsTrigger>
            <TabsTrigger
              value="schedule"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <Clock className="w-4 h-4 mr-2" />
              Schedule
            </TabsTrigger>
            <TabsTrigger
              value="versions"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <GitBranch className="w-4 h-4 mr-2" />
              Versions
            </TabsTrigger>
            <TabsTrigger
              value="machines"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <Server className="w-4 h-4 mr-2" />
              Machines
            </TabsTrigger>
            <TabsTrigger
              value="usage"
              className="rounded-lg px-4 py-2.5 data-[state=active]:bg-black data-[state=active]:text-white hover:bg-gray-100 transition-colors flex-shrink-0 whitespace-nowrap border-0"
            >
              <Terminal className="w-4 h-4 mr-2" />
              API
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="overview"
            className="space-y-6 px-8 py-6 overflow-y-auto flex-1"
          >
            <div className="grid grid-cols-2 gap-6">
              <Card className="border-2 border-black rounded-lg">
                <CardHeader className="pb-3">
                  <h4 className="font-semibold text-lg flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Metadata
                  </h4>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Active Version:</dt>
                      <dd className="font-mono">
                        v
                        {getActiveVersion()?.version_number || workflow.version}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Category:</dt>
                      <dd className="font-mono">{workflow.category}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Est. Duration:</dt>
                      <dd className="font-mono">
                        {formatDuration(workflow.estimated_duration_seconds)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Timeout:</dt>
                      <dd className="font-mono">
                        {workflow.timeout_minutes || 25} minutes
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              <Card className="border-2 border-black rounded-lg">
                <CardHeader className="pb-3">
                  <h4 className="font-semibold text-lg flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Performance
                  </h4>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Total Runs:</dt>
                      <dd className="font-mono">
                        {workflow.total_executions || 0}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Success Rate:</dt>
                      <dd className="font-mono">
                        {workflow.success_rate !== null &&
                        workflow.success_rate !== undefined &&
                        typeof workflow.success_rate === 'number'
                          ? `${Math.round(workflow.success_rate)}%`
                          : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Successful:</dt>
                      <dd className="font-mono">
                        {workflow.successful_runs || 0}
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>

            {/* Workflow details for TypeScript workflows */}
            {isTypescript && (
              <TypeScriptWorkflowTab
                workflowId={workflow.id}
                workflowFormat="typescript"
              />
            )}
          </TabsContent>

          <TabsContent
            value="workflow"
            className="space-y-6 px-8 py-6 overflow-y-auto flex-1"
          >
            {/* Show message for TypeScript workflows */}
            {isTypescript && (
              <Alert className="border-2 border-black rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This is a TypeScript workflow. YAML editing is not available.
                  Use the TypeScript tab to view workflow details.
                </AlertDescription>
              </Alert>
            )}

            {!isTypescript && (
              <div className="flex items-center gap-3 p-4 bg-white border-2 border-black rounded-lg">
                <span className="font-mono font-bold text-sm uppercase">
                  Version:
                </span>
                <Select
                  value={selectedVersionNumber}
                  onValueChange={value => {
                    setSelectedVersionNumber(value);
                    loadVersionYaml(value);
                  }}
                  disabled={loadingVersions}
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
                      .map(version => (
                        <SelectItem
                          key={version.version_number}
                          value={version.version_number}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono">
                              v{version.version_number}
                            </span>
                            {version.is_active && (
                              <Badge className="bg-black text-white text-xs">
                                ACTIVE
                              </Badge>
                            )}
                            <span className="text-xs text-gray-500">
                              {version.execution_count} runs
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {versions.find(v => v.version_number === selectedVersionNumber)
                  ?.is_active && (
                  <Badge className="bg-black text-white animate-pulse">
                    <Star className="w-3 h-3 mr-1" />
                    Active Version
                  </Badge>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold flex items-center gap-2">
                <FileCode className="w-4 h-4" />
                Current Workflow YAML
              </h4>
              <div className="flex gap-2">
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
              </div>
            </div>

            {loadingYaml ? (
              <div className="flex items-center gap-2 py-8 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading workflow YAML...</span>
              </div>
            ) : currentYaml ? (
              <div className="w-full">
                <YamlEditorWithHighlight
                  value={currentYaml}
                  onChange={() => {}}
                  readOnly={true}
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

          <TabsContent
            value="schedule"
            className="space-y-6 px-8 py-6 overflow-y-auto flex-1"
          >
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
                    <span className="ml-2">
                      Loading schedule configuration...
                    </span>
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
                      executorType={cronConfig.executorType || 'python'}
                      onChange={newConfig =>
                        setCronConfig({
                          ...newConfig,
                          executorType: cronConfig.executorType || 'python',
                        })
                      }
                      showAdvanced={true}
                    />

                    {/* Executor Type Selection (available to all users) */}
                    <div className="p-4 border-2 border-black rounded-lg bg-yellow-50">
                      <label className="block font-mono text-xs uppercase text-gray-600 mb-2">
                        Executor Type
                      </label>
                      <select
                        value={cronConfig.executorType || 'python'}
                        onChange={e =>
                          setCronConfig({
                            ...cronConfig,
                            executorType: e.target.value as 'python' | 'rust',
                          })
                        }
                        className="w-full px-3 py-2 border-2 border-black rounded font-mono text-sm"
                      >
                        <option value="python">Python (Legacy Modal)</option>
                        <option value="rust">Rust (Azure ACI)</option>
                      </select>
                      <p className="text-xs text-gray-600 mt-2 font-mono">
                        Select which executor runs this scheduled workflow
                      </p>
                    </div>
                    {/* Machine Assignment Indicator */}
                    <div className="p-4 border-2 border-black rounded-lg bg-gray-50">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-mono text-xs uppercase text-gray-600 flex items-center gap-2">
                          <Monitor className="w-4 h-4" />
                          Execution Machine
                        </h4>
                      </div>
                      {machineAssignments.length > 0 ? (
                        <div className="space-y-2">
                          {machineAssignments
                            .sort((a, b) => a.priority - b.priority)
                            .map(assignment => {
                              const machineData = availableMachines.find(
                                m => m.id === assignment.machine_id
                              );
                              return (
                                <div
                                  key={assignment.assignment_id}
                                  className="flex items-center justify-between p-2 bg-white border border-black rounded"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="font-mono font-bold truncate"
                                      title={assignment.machine_name}
                                    >
                                      {assignment.machine_name}
                                    </span>
                                    {machineData && (
                                      <span
                                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                          machineData.health_status ===
                                          'healthy'
                                            ? 'bg-black animate-pulse'
                                            : machineData.health_status ===
                                                'unhealthy'
                                              ? 'bg-gray-800'
                                              : 'bg-gray-400'
                                        }`}
                                        title={`Health: ${machineData.health_status || 'unknown'}`}
                                      />
                                    )}
                                    <Badge
                                      className={
                                        assignment.assignment_type ===
                                        'exclusive'
                                          ? 'bg-black text-white text-xs'
                                          : 'bg-white text-black border border-black text-xs'
                                      }
                                    >
                                      {assignment.assignment_type}
                                    </Badge>
                                  </div>
                                  <Button
                                    variant="black-outline"
                                    size="sm"
                                    className="h-6 px-2 text-xs"
                                    onClick={() =>
                                      removeMachineAssignment(
                                        assignment.assignment_id
                                      )
                                    }
                                    disabled={
                                      removingAssignment ===
                                      assignment.assignment_id
                                    }
                                  >
                                    {removingAssignment ===
                                    assignment.assignment_id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-3 h-3" />
                                    )}
                                  </Button>
                                </div>
                              );
                            })}
                          <p className="text-xs text-gray-600">
                            Cron jobs will execute on the assigned machine.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm text-gray-600">
                            No machine assigned. Cron jobs will use automatic
                            load-balanced assignment.
                          </p>
                          {getAvailableMachinesForAssignment().length > 0 ? (
                            <div className="flex items-center gap-2">
                              <select
                                value={selectedMachineId}
                                onChange={e =>
                                  setSelectedMachineId(e.target.value)
                                }
                                className="flex-1 p-2 border-2 border-black rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
                              >
                                <option value="">Select a machine...</option>
                                {getAvailableMachinesForAssignment()
                                  .filter(m => m.status === 'active')
                                  .map(machine => (
                                    <option
                                      key={machine.id}
                                      value={machine.id.toString()}
                                    >
                                      {machine.name}{' '}
                                      {machine.health_status === 'healthy'
                                        ? '●'
                                        : '○'}
                                    </option>
                                  ))}
                              </select>
                              <Button
                                size="sm"
                                onClick={addMachineAssignment}
                                disabled={
                                  !selectedMachineId || addingAssignment
                                }
                                className="bg-black text-white hover:bg-gray-800"
                              >
                                {addingAssignment ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  'Assign'
                                )}
                              </Button>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500 font-mono">
                              No machines available for assignment.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

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

          <TabsContent
            value="parameters"
            className="space-y-6 px-8 py-6 overflow-y-auto flex-1"
          >
            {hasDetailedInfo ? (
              <>
                <div>
                  <h4 className="font-semibold mb-3">Input Parameters</h4>
                  {Object.keys(workflow.input_parameters).length > 0 ? (
                    <div className="space-y-2">
                      {Object.entries(workflow.input_parameters).map(
                        ([key, param]: [string, any]) => (
                          <div
                            key={key}
                            className="border border-black rounded-lg p-3"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <code className="text-sm font-mono">{key}</code>
                              <Badge variant="secondary" className="text-xs">
                                {param?.type || 'string'}
                              </Badge>
                            </div>
                            {param?.description && (
                              <p className="text-sm text-muted-foreground">
                                {param.description}
                              </p>
                            )}
                            {param?.required && (
                              <Badge
                                variant="destructive"
                                className="text-xs mt-1"
                              >
                                Required
                              </Badge>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No input parameters required
                    </p>
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

          <TabsContent
            value="versions"
            className="space-y-4 overflow-y-auto flex-1 px-8 py-6"
          >
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
                  <p className="text-muted-foreground py-4">
                    No versions found for this workflow.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Active Version */}
                    {getActiveVersion() && (
                      <div className="p-2 bg-black text-white rounded border border-black">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Star className="w-3.5 h-3.5" />
                            <span className="font-medium">
                              v{getActiveVersion()!.version_number}
                            </span>
                          </div>
                          <span className="text-sm">
                            {getActiveVersion()!.execution_count} executions
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Other Versions */}
                    <div className="space-y-1">
                      {versions
                        .filter(v => !v.is_active)
                        .sort(
                          (a, b) =>
                            new Date(b.created_at).getTime() -
                            new Date(a.created_at).getTime()
                        )
                        .slice(0, 8)
                        .map(version => (
                          <div
                            key={version.version_number}
                            className="flex items-center justify-between p-2 border border-black rounded text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-medium">
                                v{version.version_number}
                              </span>
                              <span className="text-muted-foreground">
                                {version.execution_count} exec
                              </span>
                              <span className="text-muted-foreground">
                                {new Date(
                                  version.created_at
                                ).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                            <Button
                              variant="black-outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() =>
                                activateVersion(version.version_number)
                              }
                              disabled={
                                activatingVersion === version.version_number
                              }
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
                          +{versions.filter(v => !v.is_active).length - 8} more
                          versions
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="machines"
            className="space-y-4 overflow-y-auto flex-1 px-8 py-6"
          >
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
                      .map(assignment => {
                        // Find the machine data for this assignment
                        const machineData = availableMachines.find(
                          m => m.id === assignment.machine_id
                        );

                        return (
                          <div
                            key={assignment.assignment_id}
                            className="flex items-center justify-between p-2 border border-black rounded text-sm"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="font-medium truncate"
                                title={assignment.machine_name}
                              >
                                {assignment.machine_name}
                              </span>
                              {/* Health indicator for assigned machines */}
                              {machineData && (
                                <span
                                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    machineData.health_status === 'healthy'
                                      ? 'bg-black animate-pulse'
                                      : machineData.health_status ===
                                          'unhealthy'
                                        ? 'bg-gray-800'
                                        : 'bg-gray-400'
                                  }`}
                                  title={`Health: ${machineData.health_status || 'unknown'}`}
                                />
                              )}
                              <Badge
                                className={
                                  assignment.assignment_type === 'exclusive'
                                    ? 'bg-black text-white border border-black text-xs flex-shrink-0'
                                    : 'bg-white text-black border border-black text-xs flex-shrink-0'
                                }
                              >
                                {assignment.assignment_type}
                              </Badge>
                            </div>
                            <Button
                              variant="black-outline"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={() =>
                                removeMachineAssignment(
                                  assignment.assignment_id
                                )
                              }
                              disabled={
                                removingAssignment === assignment.assignment_id
                              }
                            >
                              {removingAssignment ===
                              assignment.assignment_id ? (
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
                      <Select
                        value={selectedMachineId}
                        onValueChange={setSelectedMachineId}
                      >
                        <SelectTrigger className="border-black-outline h-8 text-sm">
                          <SelectValue placeholder="Select machine" />
                        </SelectTrigger>
                        <SelectContent>
                          {getAvailableMachinesForAssignment()
                            .filter(m => m.status === 'active')
                            .map(machine => {
                              // Parse health details for tooltip with uptime
                              let healthTooltip = '';

                              // Format uptime
                              const formatUptime = (
                                uptimeSeconds: number | null | undefined
                              ): string => {
                                if (!uptimeSeconds || uptimeSeconds <= 0)
                                  return 'N/A';
                                const days = Math.floor(uptimeSeconds / 86400);
                                const hours = Math.floor(
                                  (uptimeSeconds % 86400) / 3600
                                );
                                const minutes = Math.floor(
                                  (uptimeSeconds % 3600) / 60
                                );
                                if (days > 0) return `${days}d ${hours}h`;
                                if (hours > 0) return `${hours}h ${minutes}m`;
                                return `${minutes}m`;
                              };

                              if (machine.health_details) {
                                try {
                                  const details =
                                    typeof machine.health_details === 'string'
                                      ? JSON.parse(machine.health_details)
                                      : machine.health_details;

                                  healthTooltip = `Health: ${machine.health_status || 'unknown'}\n`;

                                  // Add uptime if available
                                  if ((machine as any).uptime_seconds) {
                                    healthTooltip += `Uptime: ${formatUptime((machine as any).uptime_seconds)}\n`;
                                  }

                                  if (details.lastCheck) {
                                    const lastCheck = new Date(
                                      details.lastCheck
                                    );
                                    const timeAgo = Math.floor(
                                      (Date.now() - lastCheck.getTime()) / 1000
                                    );
                                    const timeStr =
                                      timeAgo < 60
                                        ? `${timeAgo}s ago`
                                        : timeAgo < 3600
                                          ? `${Math.floor(timeAgo / 60)}m ago`
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
                                <SelectItem
                                  key={machine.id}
                                  value={machine.id.toString()}
                                >
                                  <div
                                    className="flex items-center gap-2 max-w-[300px]"
                                    title={healthTooltip}
                                  >
                                    <span
                                      className="truncate"
                                      title={`${machine.name}\n${healthTooltip}`}
                                    >
                                      {machine.name}
                                    </span>
                                    {/* Health indicator dot */}
                                    <span
                                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                        machine.health_status === 'healthy'
                                          ? 'bg-black animate-pulse'
                                          : machine.health_status ===
                                              'unhealthy'
                                            ? 'bg-gray-800'
                                            : 'bg-gray-400'
                                      }`}
                                    />
                                    {machine.current_load !== undefined &&
                                      machine.max_concurrent && (
                                        <span className="text-xs text-muted-foreground flex-shrink-0">
                                          ({machine.current_load}/
                                          {machine.max_concurrent})
                                        </span>
                                      )}
                                  </div>
                                </SelectItem>
                              );
                            })}
                        </SelectContent>
                      </Select>

                      <div className="flex items-center justify-center h-8 px-3 border-2 border-black rounded bg-black text-white text-xs font-mono">
                        EXCLUSIVE
                      </div>

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
                  <p className="text-muted-foreground py-4">
                    No machines available for assignment.
                  </p>
                )}

                {/* All machines assigned */}
                {!loadingMachines &&
                  getAvailableMachinesForAssignment().length === 0 &&
                  availableMachines.length > 0 && (
                    <p className="text-muted-foreground py-4">
                      All available machines are already assigned to this
                      workflow.
                    </p>
                  )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent
            value="usage"
            className="space-y-6 px-8 py-6 overflow-y-auto flex-1"
          >
            <Alert>
              <Terminal className="h-4 w-4" />
              <AlertDescription>
                Execute this workflow by making a POST request to the execution
                endpoint
              </AlertDescription>
            </Alert>

            <div>
              <CodeBlock language="curl" title="cURL Example" size="sm">
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
