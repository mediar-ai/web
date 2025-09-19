'use client';

import { BatchTestDialog } from '@/components/deployments/BatchTestDialog';
import { DeleteWorkflowDialog } from '@/components/deployments/DeleteWorkflowDialog';
import { VersionUploadDialog } from '@/components/deployments/VersionUploadDialog';
import { UnifiedWorkflowDialog } from '@/components/deployments/UnifiedWorkflowDialog';
import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialogImproved';
import { WorkflowActionsDialog } from '@/components/deployments/WorkflowActionsDialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Execution,
  LiveExecutionStatus,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Edit,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  PlayCircle,
  Settings,
  Square,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState, useRef } from 'react';

interface WorkflowCardProps {
  workflow: WorkflowWithSettings;
  executions: Execution[];
  liveExecutions: LiveExecutionStatus[];
  executingWorkflows: Set<number>;
  onFetchWorkflowDetails: (workflowId: number) => void;
  onFetchExecutionDetails: (executionId: number) => void;
  loadingDetails: boolean;
  loadingExecutionId: number | null;
  loadingExecutions?: boolean;
  onBatchSubmit?: () => void;
  isNested?: boolean; // For styling nested settings workflows
  isAdmin?: boolean; // Admin role for delete permissions
}

const getStatusBadge = (status: string) => {
  // Using consistent black and white design for all statuses
  const statusStyles: Record<string, string> = {
    deployed: 'bg-white text-black border border-black', // Simple outline for deployed
    pending: 'bg-white text-black border border-gray-400', // Lighter border
    error: 'bg-white text-black border-2 border-black font-bold', // Bold text and border for emphasis
    running: 'bg-black text-white border border-black', // Active status - filled black
    completed: 'bg-white text-black border border-gray-400', // Lighter border
    completed_with_errors: 'bg-gray-100 text-black border border-black', // Warning style
    failed: 'bg-white text-black border-2 border-black font-bold', // Bold text and border for emphasis
    cancelled: 'bg-gray-100 text-gray-600 border border-gray-400', // Muted
    skipped: 'bg-gray-50 text-gray-700 border border-gray-400', // Muted style for skipped
    queued: 'bg-white text-black border border-gray-400', // Lighter border
    paused: 'bg-gray-100 text-black border border-gray-400', // Muted
  };
  return statusStyles[status] || 'bg-white text-black border border-black';
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin" />;
    case 'completed':
      return <CheckCircle className="w-3.5 h-3.5" />;
    case 'completed_with_errors':
      return <AlertCircle className="w-3.5 h-3.5" />; // Warning icon for partial success
    case 'failed':
    case 'error':
      return <XCircle className="w-3.5 h-3.5" />;
    case 'cancelled':
      return <AlertCircle className="w-3.5 h-3.5" />;
    case 'skipped':
      return <ChevronRight className="w-3.5 h-3.5" />; // Skip/forward icon
    case 'queued':
      return <Clock className="w-3.5 h-3.5" />;
    default:
      return <Activity className="w-3.5 h-3.5" />;
  }
};

const formatDuration = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

export function WorkflowCard({
  workflow,
  executions,
  liveExecutions,
  executingWorkflows,
  onFetchWorkflowDetails,
  onFetchExecutionDetails,
  loadingDetails,
  loadingExecutionId,
  loadingExecutions = false,
  onBatchSubmit,
  isNested,
  isAdmin: _isAdmin = false,
}: WorkflowCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [connectedWorkflowsExpanded, setConnectedWorkflowsExpanded] =
    useState(false);
  const [localTimeOffsets, setLocalTimeOffsets] = useState<Map<number, number>>(
    new Map()
  );
  const [showBatchTestDialog, setShowBatchTestDialog] = useState(false);
  const [showUnifiedDialog, setShowUnifiedDialog] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [templateYaml, setTemplateYaml] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');
  const [resumingWorkflow, setResumingWorkflow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: 'delete' | 'cancel' | 'cancelDelete';
    executionId: number;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingWorkflow, setDeletingWorkflow] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  const [actionsDialogMode, setActionsDialogMode] = useState<'rename' | 'duplicate' | null>(null);

  // Inline editing state
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [tempName, setTempName] = useState(workflow.name);
  const [tempDescription, setTempDescription] = useState(workflow.description || '');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);

  // Cache-related state for showing preview results for pending executions
  const [executionCacheResults, setExecutionCacheResults] = useState<
    Map<
      number,
      {
        quotes_found?: number;
        status?: 'completed' | 'failed';
        error_message?: string;
        execution_duration_seconds?: number;
        cached: boolean;
      }
    >
  >(new Map());

  // Fetch execution details to get parameters needed for cache lookup
  const fetchExecutionDetails = useCallback(
    async (executionId: number): Promise<Record<string, unknown> | null> => {
      try {
        const response = await fetch(
          `/api/remote-workflows/executions/${executionId}`
        );

        if (!response.ok) {
          console.warn(
            `Execution details API returned ${response.status} for execution ${executionId}`
          );
          return null;
        }

        const data = await response.json();

        if (data.success && data.execution?.execution_params) {
          console.log(
            `[SUCCESS] Fetched execution details for ${executionId}, status: ${data.execution.status}`
          );
          return data.execution.execution_params;
        } else {
          console.log(
            `ℹ️ No execution parameters available for execution ${executionId}`
          );
          return null;
        }
      } catch (error) {
        // Network or parsing error - log but don't throw since this is enhancement feature
        console.warn(
          `Failed to fetch execution details for ${executionId}:`,
          error
        );
        return null;
      }
    },
    []
  );

  // Cache lookup function for pending executions
  const lookupCacheForExecution = useCallback(
    async (executionId: number) => {
      // First check if this execution is still in a pending state that makes sense for cache lookup
      const currentExecution = liveExecutions.find(
        exec => exec.id === executionId
      );
      if (
        !currentExecution ||
        !['queued', 'running'].includes(currentExecution.status)
      ) {
        console.log(
          `[WARN] Skipping cache lookup for execution ${executionId}: not in pending state (current status: ${currentExecution?.status || 'not found'})`
        );
        return;
      }

      // Get the execution parameters
      const executionParams = await fetchExecutionDetails(executionId);
      if (!executionParams) {
        console.log(
          `No execution parameters found for execution ${executionId}`
        );
        // Mark as checked even if no params to avoid infinite retries
        setExecutionCacheResults(prev =>
          new Map(prev).set(executionId, {
            cached: false,
            status: 'failed',
            error_message: 'No execution parameters available',
          })
        );
        return;
      }

      try {
        const response = await fetch(
          `/api/remote-workflows/cache?detailed_output=false`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workflow_id: workflow.id,
              parameters: executionParams,
            }),
          }
        );

        if (!response.ok) {
          console.warn(
            `Cache lookup API returned ${response.status} for execution ${executionId}`
          );
          // Mark as checked to prevent infinite retries on API errors
          setExecutionCacheResults(prev =>
            new Map(prev).set(executionId, {
              cached: false,
              status: 'failed',
              error_message: `API error: ${response.status}`,
            })
          );
          return;
        }

        const data = await response.json();
        if (data.success && data.cached) {
          setExecutionCacheResults(prev =>
            new Map(prev).set(executionId, {
              quotes_found: data.execution?.quotes?.length || 0,
              status: data.execution?.status || 'completed',
              error_message: data.execution?.error_message,
              execution_duration_seconds:
                data.execution?.execution_duration_seconds,
              cached: true,
            })
          );
          console.log(
            `[SUCCESS] Cache hit found for execution ${executionId} from execution ${data.cache_info?.source_execution_id}`
          );
        } else {
          console.log(
            `ℹ️ No cache available for execution ${executionId} parameters`
          );
          // [FIX] FIX: Mark cache miss as checked to prevent infinite retries
          setExecutionCacheResults(prev =>
            new Map(prev).set(executionId, {
              cached: false,
              status: 'completed', // Indicates we checked but no cache available
            })
          );
        }
      } catch (error) {
        // Log the error but don't throw - this is a non-critical enhancement feature
        console.warn(
          `Cache lookup failed for execution ${executionId}:`,
          error
        );
        // [FIX] FIX: Mark failed lookups as checked to prevent infinite retries
        setExecutionCacheResults(prev =>
          new Map(prev).set(executionId, {
            cached: false,
            status: 'failed',
            error_message:
              error instanceof Error ? error.message : 'Unknown error',
          })
        );
      }
    },
    [
      workflow.id,
      fetchExecutionDetails,
      setExecutionCacheResults,
      liveExecutions,
    ]
  );

  // Resume workflow function
  const handleResumeWorkflow = async () => {
    setResumingWorkflow(true);
    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/resume`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (data.success) {
        console.log('Workflow resumed successfully:', data.message);
        // Trigger a refresh of the workflow data
        if (onBatchSubmit) {
          onBatchSubmit(); // This is used to refresh the parent component
        }
      } else {
        console.error('Failed to resume workflow:', data.error);
        alert(`Failed to resume workflow: ${data.error}`);
      }
    } catch (error) {
      console.error('Error resuming workflow:', error);
      alert('Failed to resume workflow. Please try again.');
    } finally {
      setResumingWorkflow(false);
    }
  };

  const requestCancelExecution = async (executionId: number) => {
    const resp = await fetch(
      `/api/remote-workflows/executions/${executionId}/status`,
      { method: 'DELETE' }
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.error || `Failed to cancel (HTTP ${resp.status})`);
    }
  };

  const requestDeleteExecution = async (executionId: number, force = false) => {
    const url = force
      ? `/api/remote-workflows/executions/${executionId}?force=true`
      : `/api/remote-workflows/executions/${executionId}`;
    const resp = await fetch(url, { method: 'DELETE' });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data?.error || `Failed to delete (HTTP ${resp.status})`);
    }
  };

  // Handle cron toggle (pause/resume)
  const [cronToggling, setCronToggling] = useState(false);

  const handleCronToggle = async () => {
    setCronToggling(true);
    try {
      const response = await fetch(
        `/api/remote-workflows/${workflow.id}/cron`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ enabled: !workflow.cron_enabled }),
        }
      );

      const result = await response.json();

      if (result.success) {
        // Trigger a refresh of the workflow list
        if (onBatchSubmit) {
          onBatchSubmit();
        }
      } else {
        console.error('Failed to toggle cron schedule:', result.error);
        alert(
          `Failed to ${!workflow.cron_enabled ? 'enable' : 'disable'} schedule`
        );
      }
    } catch (error) {
      console.error('Error toggling cron schedule:', error);
      alert(
        `Error ${!workflow.cron_enabled ? 'enabling' : 'disabling'} schedule`
      );
    } finally {
      setCronToggling(false);
    }
  };

  // Helper function to convert cron expression to human-readable format
  const getCronDescription = (cronExpression: string): string => {
    // Simple cron parser for common patterns
    const parts = cronExpression.split(' ');
    if (parts.length < 5) return cronExpression;

    const [second, minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // Handle common patterns (with 6-field cron format)
    if (
      second === '0' &&
      minute === '*/1' &&
      hour === '*' &&
      dayOfMonth === '*' &&
      month === '*' &&
      dayOfWeek === '*'
    ) {
      return 'every minute';
    }
    if (
      second === '0' &&
      minute === '*/5' &&
      hour === '*' &&
      dayOfMonth === '*' &&
      month === '*' &&
      dayOfWeek === '*'
    ) {
      return 'every 5 minutes';
    }
    if (
      second === '0' &&
      minute === '0' &&
      hour === '0' &&
      dayOfMonth === '*' &&
      month === '*' &&
      dayOfWeek === '*'
    ) {
      return 'daily at midnight';
    }
    if (
      second === '0' &&
      minute === '0' &&
      hour === '9' &&
      dayOfMonth === '*' &&
      month === '*' &&
      dayOfWeek === '1-5'
    ) {
      return 'weekdays at 9:00 AM';
    }

    // For other patterns, provide a basic description
    let description = '';

    if (minute !== '*') {
      description += minute.includes('*/')
        ? `every ${minute.replace('*/', '')} min`
        : `at ${minute} min`;
    }
    if (hour !== '*') {
      description += hour.includes('*/')
        ? ` every ${hour.replace('*/', '')} hr`
        : ` at ${hour}:00`;
    }
    if (dayOfWeek !== '*' && dayOfWeek !== '?') {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      description +=
        ' on ' +
        dayOfWeek
          .split(',')
          .map(d => days[parseInt(d)] || d)
          .join(', ');
    }

    return description.trim() || 'periodically';
  };

  const handleOpenActionsDialog = (mode: 'rename' | 'duplicate') => {
    setActionsDialogMode(mode);
    setActionsDialogOpen(true);
  };

  // Inline editing handlers
  const handleStartEditingName = () => {
    setEditingName(true);
    setTempName(workflow.name);
    setTimeout(() => {
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.select();
      }
    }, 0);
  };

  const handleStartEditingDescription = () => {
    setEditingDescription(true);
    setTempDescription(workflow.description || '');
    setTimeout(() => {
      if (descriptionInputRef.current) {
        descriptionInputRef.current.focus();
        descriptionInputRef.current.select();
      }
    }, 0);
  };

  const handleSaveName = async () => {
    if (!tempName.trim() || tempName.trim() === workflow.name) {
      setEditingName(false);
      setTempName(workflow.name);
      return;
    }

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/rename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: tempName.trim() }),
      });

      const result = await response.json();

      if (result.success) {
        setEditingName(false);
        if (onBatchSubmit) {
          onBatchSubmit();
        }
      } else {
        alert(result.error || 'Failed to rename workflow');
        setTempName(workflow.name);
        setEditingName(false);
      }
    } catch (error) {
      console.error('Error renaming workflow:', error);
      alert('Failed to rename workflow');
      setTempName(workflow.name);
      setEditingName(false);
    }
  };

  const handleSaveDescription = async () => {
    if (tempDescription === workflow.description) {
      setEditingDescription(false);
      return;
    }

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/rename`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: workflow.name,
          description: tempDescription
        }),
      });

      const result = await response.json();

      if (result.success) {
        setEditingDescription(false);
        if (onBatchSubmit) {
          onBatchSubmit();
        }
      } else {
        alert(result.error || 'Failed to update description');
        setTempDescription(workflow.description || '');
        setEditingDescription(false);
      }
    } catch (error) {
      console.error('Error updating description:', error);
      alert('Failed to update description');
      setTempDescription(workflow.description || '');
      setEditingDescription(false);
    }
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setTempName(workflow.name);
  };

  const handleCancelEditDescription = () => {
    setEditingDescription(false);
    setTempDescription(workflow.description || '');
  };

  const handleDeleteWorkflow = async (workflowId: number) => {
    setDeletingWorkflow(true);
    try {
      console.log(`🗑️ Deleting workflow: ${workflow.name} (ID: ${workflowId})`);

      const response = await fetch(
        `/api/remote-workflows/${workflowId}/delete`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();

      if (result.success) {
        console.log(`✅ Successfully deleted workflow: ${workflow.name}`);

        // Show success feedback
        alert(`✅ Workflow "${workflow.name}" deleted successfully!`);

        // Close the dialog first
        setDeleteDialogOpen(false);

        // Refresh the workflows list immediately
        if (onBatchSubmit) {
          console.log('🔄 Triggering workflows list refresh...');
          onBatchSubmit();
        }
      } else {
        console.error('Failed to delete workflow:', result.error);
        alert(`❌ Failed to delete workflow: ${result.error}`);
      }
    } catch (error) {
      console.error('Error deleting workflow:', error);
      alert('❌ Error deleting workflow. Please try again.');
    } finally {
      setDeletingWorkflow(false);
    }
  };

  const handleConfirm = async () => {
    if (!pendingAction) return;
    setActionLoading(true);
    try {
      if (pendingAction.type === 'cancel') {
        await requestCancelExecution(pendingAction.executionId);
      } else if (pendingAction.type === 'delete') {
        await requestDeleteExecution(pendingAction.executionId, false);
      } else {
        // cancelDelete
        await requestDeleteExecution(pendingAction.executionId, true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Operation failed');
    } finally {
      setActionLoading(false);
      setConfirmOpen(false);
      setPendingAction(null);
    }
  };

  // Effect to trigger cache lookups for pending executions
  useEffect(() => {
    const pendingExecutions = liveExecutions.filter(
      exec =>
        exec.workflow_id === workflow.id &&
        (exec.status === 'queued' || exec.status === 'running')
    );

    // Only lookup cache for executions we haven't already checked
    pendingExecutions.forEach(exec => {
      if (!executionCacheResults.has(exec.id)) {
        lookupCacheForExecution(exec.id);
      }
    });
  }, [
    liveExecutions,
    workflow.id,
    executionCacheResults,
    lookupCacheForExecution,
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalTimeOffsets(prev => {
        const newMap = new Map(prev);
        liveExecutions.forEach(exec => {
          if (exec.workflow_id === workflow.id) {
            if (exec.status === 'running' && exec.started_at) {
              // For running executions, show time since started
              const startTime = new Date(exec.started_at).getTime();
              const now = Date.now();
              const runtimeSeconds = Math.floor((now - startTime) / 1000);
              newMap.set(exec.id, runtimeSeconds);
            } else if (exec.status === 'queued' && exec.created_at) {
              // For queued executions, show negative time to indicate waiting
              const createdTime = new Date(exec.created_at).getTime();
              const now = Date.now();
              const waitingSeconds = Math.floor((now - createdTime) / 1000);
              newMap.set(exec.id, -waitingSeconds); // Negative to distinguish from running
            } else {
              newMap.delete(exec.id);
            }
          }
        });
        return newMap;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [liveExecutions, workflow.id]);

  const workflowLiveExecutions = liveExecutions
    .filter(exec => exec.workflow_id === workflow.id)
    .sort((a, b) => b.id - a.id);

  const recentExecutions = executions
    .filter(exec => exec.workflow_id === workflow.id)
    .filter(exec => !['running', 'queued'].includes(exec.status))
    .sort((a, b) => b.execution_id - a.execution_id);

  // Create unified execution list
  type UnifiedExecution = {
    execution_id: number;
    workflow_id: number;
    status: string;
    created_at: string;
    started_at?: string | null;
    completed_at?: string | null;
    execution_duration_seconds?: number | null;
    error_message?: string | null;
    formatted_output?: string | null;
    progress_percentage?: number;
    current_step_description?: string | null;
    version_number?: string | null;
    workflow_version_id?: number | null;
    isLive: boolean;
  };

  const unifiedExecutions: UnifiedExecution[] = [
    // Map live executions to have consistent structure
    ...workflowLiveExecutions.map(exec => ({
      execution_id: exec.id,
      workflow_id: exec.workflow_id,
      status: exec.status,
      created_at: exec.created_at,
      started_at: exec.started_at || null,
      completed_at: null,
      execution_duration_seconds: exec.execution_duration_seconds,
      error_message: null,
      formatted_output: null,
      progress_percentage: exec.progress_percentage,
      current_step_description: exec.current_step_description,
      version_number: exec.version_number || null,
      workflow_version_id: exec.workflow_version_id || null,
      isLive: true,
    })),
    // Add recent executions with isLive flag
    ...recentExecutions.map(exec => ({
      execution_id: exec.execution_id,
      workflow_id: exec.workflow_id,
      status: exec.status,
      created_at: exec.created_at || '',
      started_at: exec.started_at || null,
      completed_at: exec.completed_at || null,
      execution_duration_seconds: exec.execution_duration_seconds,
      error_message: exec.error_message || null,
      formatted_output: exec.formatted_output || null,
      progress_percentage: exec.progress_percentage,
      current_step_description: null,
      version_number: exec.version_number || null,
      workflow_version_id: exec.workflow_version_id || null,
      isLive: false,
    })),
  ]
    // Remove duplicates (in case of race conditions)
    .filter(
      (exec, index, self) =>
        index === self.findIndex(e => e.execution_id === exec.execution_id)
    )
    // Sort by execution ID descending (newest first)
    .sort((a, b) => b.execution_id - a.execution_id);

  const hasExecutions = unifiedExecutions.length > 0;
  const shouldShowExecutionHistory = hasExecutions || loadingExecutions;

  return (
    <Card
      className={`border-black ${isNested ? 'bg-gray-50 border-l-4 border-l-black border-t border-r border-b' : ''}`}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {/* First line: Workflow title and status */}
            <div className="flex items-center justify-between mb-2">
              {editingName ? (
                <Input
                  ref={nameInputRef}
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveName();
                    } else if (e.key === 'Escape') {
                      handleCancelEditName();
                    }
                  }}
                  onBlur={handleSaveName}
                  className="text-xl font-bold font-mono border-2 border-black focus:outline-none focus:ring-2 focus:ring-black max-w-md"
                />
              ) : (
                <h3
                  className="text-xl font-bold font-mono cursor-pointer hover:bg-gray-100 px-2 py-1 -ml-2 rounded transition-colors"
                  onClick={handleStartEditingName}
                  title="Click to edit"
                >
                  {workflow.name}
                </h3>
              )}
              {/* Status badge - moved to title line */}
              <div className="flex items-center gap-2">
                <Badge
                  className={`${getStatusBadge(workflow.status)} text-xs h-6 px-2 font-mono`}
                >
                  {workflow.status.toUpperCase()}
                </Badge>
                {workflow.cron_expression && (
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-xs h-6 px-2 font-mono text-black border-black"
                      title={`Runs ${getCronDescription(workflow.cron_expression)}`}
                    >
                      {workflow.cron_expression}
                    </Badge>
                    <button
                      onClick={handleCronToggle}
                      disabled={cronToggling}
                      className={`px-2 py-1 border-2 border-black rounded font-mono text-xs font-bold transition-colors ${
                        cronToggling
                          ? 'bg-gray-100 cursor-not-allowed'
                          : workflow.cron_enabled
                            ? 'bg-black text-white hover:bg-gray-700 cursor-pointer'
                            : 'bg-white text-black hover:bg-gray-100 cursor-pointer'
                      }`}
                      title={
                        cronToggling
                          ? 'Processing...'
                          : workflow.cron_enabled
                            ? 'Pause schedule'
                            : 'Resume schedule'
                      }
                    >
                      {cronToggling ? (
                        <Loader2 className="w-4 h-4 animate-spin inline" />
                      ) : workflow.cron_enabled ? (
                        <>
                          <Pause className="w-4 h-4 inline mr-1" />
                          PAUSE
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 inline mr-1" />
                          START
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Second line: stats, play button, and status */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              {/* Enhanced Stats - Overall and Current Version */}
              <div className="flex items-center gap-3 text-sm font-mono">
                {/* Overall Stats */}
                <div className="flex items-center gap-2 text-gray-600">
                  <span>TOTAL: {workflow.total_executions || 0}</span>
                  {(workflow.total_executions || 0) > 0 && (
                    <span className="text-black flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      {Math.round(
                        ((workflow.successful_runs || 0) /
                          (workflow.total_executions || 1)) *
                          100
                      )}
                      %
                    </span>
                  )}
                  {/* Show skipped count if any */}
                  {(workflow.skipped_runs || 0) > 0 && (
                    <>
                      <span className="text-gray-400">•</span>
                      <span className="text-blue-600 flex items-center gap-1">
                        <ChevronRight className="w-4 h-4" />
                        {workflow.skipped_runs} skipped
                      </span>
                    </>
                  )}
                </div>

                {/* Current Version Stats */}
                {workflow.current_version_stats &&
                  workflow.current_version_stats.total_executions > 0 && (
                    <>
                      <span className="text-gray-400">•</span>
                      <div className="flex items-center gap-2">
                        <span className="text-black font-semibold">
                          v{workflow.version_info?.current_version}
                        </span>
                      </div>
                    </>
                  )}

                {/* Duration */}
                {workflow.estimated_duration_seconds && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-black">
                      in {workflow.estimated_duration_seconds} sec.
                    </span>
                  </>
                )}
              </div>

              {/* Resume/Play button */}
              {workflow.status === 'paused' && (
                <button
                  onClick={handleResumeWorkflow}
                  disabled={resumingWorkflow}
                  className="p-1 border border-black rounded hover:bg-gray-100 transition-colors cursor-pointer disabled:cursor-not-allowed"
                  title={resumingWorkflow ? 'Resuming...' : 'Resume workflow'}
                >
                  {resumingWorkflow ? (
                    <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 text-gray-600 hover:text-black" />
                  )}
                </button>
              )}
            </div>

            {/* Third line: Action buttons in their own row */}
            <div className="flex items-center gap-2 mb-2">
              {/* Test Run - shows automated status for active cron */}
              {workflow.cron_expression && workflow.cron_enabled ? (
                <div className="flex items-center gap-2 px-6 py-2.5 bg-gray-100 border-2 border-black rounded-lg font-mono text-base font-bold">
                  <Clock className="w-5 h-5" />
                  AUTOMATED
                </div>
              ) : (
                <Button
                  onClick={() => setShowBatchTestDialog(true)}
                  className="bg-black text-white hover:bg-gray-700 font-mono text-base h-10 px-6 cursor-pointer transition-all duration-200 rounded-lg font-bold"
                  size="lg"
                >
                  <PlayCircle className="w-5 h-5 mr-2" />
                  TEST RUN
                </Button>
              )}

              {/* Workflow Actions Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 border-2 border-black hover:bg-gray-100"
                  >
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => handleOpenActionsDialog('rename')}>
                    <Edit className="mr-2 h-4 w-4" />
                    Rename Workflow
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOpenActionsDialog('duplicate')}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate Workflow
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <VersionUploadDialog
                    workflowId={workflow.id}
                    workflowName={workflow.name}
                    onUploadSuccess={() => {
                      if (onBatchSubmit) {
                        onBatchSubmit();
                      }
                    }}
                  >
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Version
                    </DropdownMenuItem>
                  </VersionUploadDialog>
                  <DropdownMenuItem onClick={() => setShowUnifiedDialog(true)}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings & Details
                  </DropdownMenuItem>
                  {!isNested && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteDialogOpen(true)}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete Workflow
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {editingDescription ? (
              <Textarea
                ref={descriptionInputRef}
                value={tempDescription}
                onChange={(e) => setTempDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    handleCancelEditDescription();
                  }
                }}
                onBlur={handleSaveDescription}
                className="text-black text-base mb-2 border-2 border-black focus:outline-none focus:ring-2 focus:ring-black resize-none"
                rows={2}
              />
            ) : (
              <p
                className="text-black text-base mb-2 cursor-pointer hover:bg-gray-100 px-2 py-1 -ml-2 rounded transition-colors"
                onClick={handleStartEditingDescription}
                title="Click to edit description"
              >
                {workflow.description || 'Click to add description...'}
              </p>
            )}

            {/* Cron workflow notice */}
            {workflow.cron_expression && workflow.cron_enabled && (
              <div className="mt-2 p-3 bg-gray-50 border border-gray-300 rounded-lg">
                <div className="flex items-center gap-2 text-gray-700">
                  <Clock className="w-4 h-4" />
                  <span className="font-semibold text-sm">
                    Automated Workflow
                  </span>
                </div>
                <p className="text-gray-600 text-xs mt-1">
                  This workflow runs automatically on schedule. Manual execution
                  is disabled. Use the cron badge above to view schedule details
                  or pause automation.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {/* Settings Workflows Section - Nested WorkflowCards */}
        {workflow.settings_workflows &&
          workflow.settings_workflows.length > 0 && (
            <div className="mb-4 border-t border-gray-200 pt-4">
              <Collapsible
                open={connectedWorkflowsExpanded}
                onOpenChange={setConnectedWorkflowsExpanded}
              >
                <CollapsibleTrigger className="w-full cursor-pointer">
                  <div className="flex items-center gap-2 p-3 bg-gray-50 border border-black rounded hover:bg-gray-100 transition-colors cursor-pointer">
                    {connectedWorkflowsExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <h4 className="text-base font-bold font-mono text-black">
                      <span>
                        CONNECTED WORKFLOWS (
                        {workflow.settings_workflows.length})
                      </span>
                    </h4>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-3 ml-4 mt-3">
                    {workflow.settings_workflows.map(settingsWorkflow => (
                      <WorkflowCard
                        key={settingsWorkflow.id}
                        workflow={settingsWorkflow as WorkflowWithSettings}
                        executions={[]} // Settings workflows don't have executions yet
                        liveExecutions={[]} // Settings workflows don't have live executions yet
                        executingWorkflows={executingWorkflows}
                        onFetchWorkflowDetails={onFetchWorkflowDetails}
                        onFetchExecutionDetails={onFetchExecutionDetails}
                        loadingDetails={loadingDetails}
                        loadingExecutionId={loadingExecutionId}
                        loadingExecutions={false}
                        onBatchSubmit={onBatchSubmit}
                        isNested={true}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

        {shouldShowExecutionHistory && (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger className="w-full cursor-pointer">
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-black rounded hover:bg-gray-100 transition-colors cursor-pointer">
                <div className="flex items-center gap-2">
                  {expanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                  <span className="text-base font-bold font-mono text-black">
                    EXECUTION HISTORY
                  </span>
                  <div className="flex gap-2">
                    {loadingExecutions ? (
                      <Badge
                        variant="black-outline"
                        className="text-sm h-7 px-3"
                      >
                        <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        LOADING
                      </Badge>
                    ) : (
                      <>
                        {workflowLiveExecutions.length > 0 && (
                          <Badge
                            variant="black-outline"
                            className="text-sm h-7 px-3"
                          >
                            {workflowLiveExecutions.length} LIVE
                          </Badge>
                        )}
                        {recentExecutions.length > 0 && (
                          <Badge
                            variant="black-outline"
                            className="text-sm h-7 px-3"
                          >
                            {recentExecutions.length} RECENT
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="mt-2 max-h-[400px] overflow-y-auto border border-black rounded-lg bg-white">
                {loadingExecutions ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
                      <span className="text-base font-mono text-gray-600">
                        Loading execution history...
                      </span>
                    </div>
                  </div>
                ) : unifiedExecutions.length === 0 ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="text-base text-gray-500">
                      No execution history available
                    </span>
                  </div>
                ) : (
                  unifiedExecutions.map((execution, index) => (
                    <div
                      key={`exec-${execution.execution_id}`}
                      className={`px-4 py-1.5 ${
                        index > 0 ? 'border-t border-gray-200' : ''
                      } ${
                        loadingExecutionId === execution.execution_id
                          ? 'bg-blue-50 cursor-wait'
                          : 'cursor-pointer hover:bg-gray-50'
                      }`}
                      onClick={() =>
                        loadingExecutionId === null &&
                        onFetchExecutionDetails(execution.execution_id)
                      }
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-black font-semibold">
                          #{execution.execution_id}
                        </span>
                        {loadingExecutionId === execution.execution_id ? (
                          <div className="flex items-center gap-1">
                            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                            <span className="text-sm font-mono text-blue-600">
                              LOADING...
                            </span>
                          </div>
                        ) : (
                          <>
                            <Badge
                              className={`${getStatusBadge(execution.status)} h-7 px-3 text-sm`}
                            >
                              {getStatusIcon(execution.status)}
                              <span className="ml-0.5">
                                {execution.status.toUpperCase()}
                              </span>
                            </Badge>

                            {/* Version Badge */}
                            {execution.version_number && (
                              <Badge
                                variant="outline"
                                className="text-xs px-2 py-0.5"
                              >
                                v{execution.version_number}
                              </Badge>
                            )}
                          </>
                        )}
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap">
                          {execution.isLive ? (
                            <>
                              {execution.status === 'queued' &&
                                !execution.started_at && (
                                  <span className="flex items-center gap-0.5">
                                    <Clock className="w-3.5 h-3.5" />
                                    Queued{' '}
                                    {new Date(
                                      execution.created_at
                                    ).toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                )}
                              {execution.status === 'running' &&
                                execution.started_at && (
                                  <span className="flex items-center gap-0.5">
                                    <Clock className="w-3.5 h-3.5" />
                                    Started{' '}
                                    {new Date(
                                      execution.started_at
                                    ).toLocaleTimeString('en-US', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </span>
                                )}
                              {localTimeOffsets.has(execution.execution_id) && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="font-mono">
                                    {(() => {
                                      const offset =
                                        localTimeOffsets.get(
                                          execution.execution_id
                                        ) ?? 0;
                                      if (offset < 0) {
                                        // Queued - show waiting time
                                        const waitingSeconds = Math.abs(offset);
                                        return (
                                          <>
                                            <span className="text-orange-600">
                                              Waiting:{' '}
                                            </span>
                                            <span className="text-orange-600 font-bold">
                                              {waitingSeconds}s
                                            </span>
                                            {waitingSeconds >= 60 && (
                                              <span className="text-gray-500 ml-1">
                                                (
                                                {formatDuration(waitingSeconds)}
                                                )
                                              </span>
                                            )}
                                          </>
                                        );
                                      } else {
                                        // Running - show execution time
                                        return (
                                          <>
                                            <span className="text-black font-bold">
                                              {offset}s
                                            </span>
                                            {offset >= 60 && (
                                              <span className="text-gray-500 ml-1">
                                                ({formatDuration(offset)})
                                              </span>
                                            )}
                                          </>
                                        );
                                      }
                                    })()}
                                  </span>
                                </>
                              )}
                              {execution.progress_percentage !== undefined && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span>{execution.progress_percentage}%</span>
                                </>
                              )}
                              {execution.current_step_description && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span
                                    className="text-blue-600 truncate inline-block max-w-[450px]"
                                    title={execution.current_step_description}
                                  >
                                    {execution.current_step_description}
                                  </span>
                                </>
                              )}
                              {/* Cache preview for pending executions */}
                              {executionCacheResults.has(
                                execution.execution_id
                              ) && (
                                <>
                                  <span className="text-gray-400">•</span>
                                  <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs">
                                    <span className="text-blue-600 font-mono">
                                      CACHE:
                                    </span>
                                    {(() => {
                                      const cacheResult =
                                        executionCacheResults.get(
                                          execution.execution_id
                                        );
                                      if (!cacheResult) return null;

                                      if (cacheResult.quotes_found) {
                                        return (
                                          <span className="text-green-600 font-semibold">
                                            {cacheResult.quotes_found} quotes (
                                            {formatDuration(
                                              cacheResult.execution_duration_seconds
                                            )}
                                            )
                                          </span>
                                        );
                                      } else if (
                                        cacheResult.status === 'failed'
                                      ) {
                                        return (
                                          <span className="text-black font-bold">
                                            Failed (
                                            {formatDuration(
                                              cacheResult.execution_duration_seconds
                                            )}
                                            )
                                          </span>
                                        );
                                      } else {
                                        return (
                                          <span className="text-green-600 font-semibold">
                                            Available (
                                            {formatDuration(
                                              cacheResult.execution_duration_seconds
                                            )}
                                            )
                                          </span>
                                        );
                                      }
                                    })()}
                                  </span>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              {execution.completed_at && (
                                <span className="flex items-center gap-0.5">
                                  <Clock className="w-3.5 h-3.5" />
                                  {new Date(
                                    execution.completed_at
                                  ).toLocaleString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              )}
                              {execution.execution_duration_seconds !==
                                undefined &&
                                execution.execution_duration_seconds !==
                                  null && (
                                  <>
                                    <span className="text-gray-400">•</span>
                                    <span>
                                      {formatDuration(
                                        execution.execution_duration_seconds
                                      )}
                                    </span>
                                  </>
                                )}
                              {execution.status === 'completed' &&
                                execution.formatted_output && (
                                  <>
                                    <span className="text-gray-400">•</span>
                                    <div className="flex items-center gap-1.5 text-sm flex-wrap">
                                      {(() => {
                                        try {
                                          const quotes = JSON.parse(
                                            execution.formatted_output
                                          );
                                          if (
                                            Array.isArray(quotes) &&
                                            quotes.length > 0
                                          ) {
                                            const quotesToShow = quotes.slice(
                                              0,
                                              2
                                            );
                                            const quoteDisplay = quotesToShow
                                              .map(
                                                q =>
                                                  `${q.carrierProduct?.split(':')[0]}: ${q.quoteValue || ''}`
                                              )
                                              .join(' | ');
                                            const fullTitle = quotes
                                              .map(
                                                q =>
                                                  `${q.carrierProduct}: ${q.quoteValue || ''}`
                                              )
                                              .join(', ');

                                            return (
                                              <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-green-700">
                                                  {quotes.length} quote
                                                  {quotes.length > 1
                                                    ? 's'
                                                    : ''}{' '}
                                                  found:
                                                </span>
                                                <span
                                                  className="font-mono bg-gray-100 px-2 py-0.5 rounded-full text-gray-700 truncate max-w-[400px]"
                                                  title={fullTitle}
                                                >
                                                  {quoteDisplay}
                                                </span>
                                                {quotes.length > 2 && (
                                                  <span className="text-gray-500">
                                                    ...
                                                  </span>
                                                )}
                                              </div>
                                            );
                                          }
                                          return (
                                            <span
                                              className="text-green-700 truncate inline-block max-w-[450px]"
                                              title={execution.formatted_output}
                                            >
                                              {
                                                execution.formatted_output.split(
                                                  '\n'
                                                )[0]
                                              }
                                            </span>
                                          );
                                        } catch {
                                          return (
                                            <span
                                              className="text-green-700 truncate inline-block max-w-[450px]"
                                              title={execution.formatted_output}
                                            >
                                              {
                                                execution.formatted_output.split(
                                                  '\n'
                                                )[0]
                                              }
                                            </span>
                                          );
                                        }
                                      })()}
                                    </div>
                                  </>
                                )}
                              {execution.status === 'skipped' &&
                                (execution.error_message ||
                                  execution.formatted_output) && (
                                  <>
                                    <span className="text-gray-400">•</span>
                                    <span
                                      className="text-blue-600 truncate inline-block max-w-[450px] text-sm"
                                      title={
                                        execution.error_message ||
                                        execution.formatted_output ||
                                        'Workflow was skipped'
                                      }
                                    >
                                      {execution.error_message || 
                                       (execution.formatted_output ? 
                                        (() => {
                                          try {
                                            const parsed = JSON.parse(execution.formatted_output);
                                            return parsed.message || 'Workflow skipped';
                                          } catch {
                                            return execution.formatted_output.split('\n')[0];
                                          }
                                        })() : 
                                        'Workflow skipped')}
                                    </span>
                                  </>
                                )}
                              {execution.status === 'failed' &&
                                (execution.error_message ||
                                  execution.formatted_output) && (
                                  <>
                                    <span className="text-gray-400">•</span>
                                    <span
                                      className="text-black font-bold truncate inline-block max-w-[450px] text-sm"
                                      title={
                                        execution.error_message ||
                                        execution.formatted_output ||
                                        ''
                                      }
                                    >
                                      {(() => {
                                        // Try to parse formatted_output if it's JSON (standardized format)
                                        let standardizedError = null;
                                        if (execution.formatted_output) {
                                          try {
                                            const parsed = JSON.parse(
                                              execution.formatted_output
                                            );
                                            if (
                                              parsed.status ===
                                              'partial_success'
                                            ) {
                                              standardizedError = `${parsed.message} - ${parsed.details?.description || ''}`;
                                            } else if (
                                              !parsed.success &&
                                              parsed.message
                                            ) {
                                              standardizedError =
                                                parsed.message;
                                            }
                                          } catch {
                                            // Not JSON, use as-is
                                          }
                                        }

                                        if (standardizedError) {
                                          return standardizedError;
                                        } else if (execution.error_message)
                                          return execution.error_message;
                                        if (execution.formatted_output) {
                                          const lines =
                                            execution.formatted_output.split(
                                              '\n'
                                            );
                                          const hasCompletedMessage =
                                            lines.some((line: string) =>
                                              line.includes(
                                                '[SUCCESS] Workflow execution completed!'
                                              )
                                            );
                                          const hasNoQuotesFound = lines.some(
                                            (line: string) =>
                                              line.includes(
                                                '[ERROR] No Eligible Quotes Found'
                                              ) ||
                                              line.includes(
                                                'No Eligible Quotes Found'
                                              )
                                          );
                                          if (
                                            hasCompletedMessage &&
                                            hasNoQuotesFound
                                          ) {
                                            const successfulStepsLine =
                                              lines.find((line: string) =>
                                                line.includes(
                                                  'Successful Steps:'
                                                )
                                              );
                                            if (
                                              successfulStepsLine &&
                                              successfulStepsLine.includes(
                                                'Successful Steps: 0'
                                              )
                                            )
                                              return 'Workflow failed - No steps completed successfully';
                                            else if (hasNoQuotesFound)
                                              return 'Workflow incomplete - No quotes found';
                                          }
                                          const errorLine = lines.find(
                                            (line: string) =>
                                              line.includes('[ERROR]') ||
                                              line.includes('Message:') ||
                                              line.includes('Error:') ||
                                              line.includes('Failed:') ||
                                              line.includes('failed!')
                                          );
                                          if (errorLine)
                                            return errorLine
                                              .replace(/^\s*Message:\s*/, '')
                                              .replace(/^\s*Error:\s*/, '')
                                              .replace(/^[ERROR]\s*/, '')
                                              .trim();
                                          return (
                                            lines.find(
                                              (line: string) =>
                                                line.trim() &&
                                                !line.includes('===') &&
                                                !line.includes('---')
                                            ) || 'Workflow execution failed'
                                          );
                                        }
                                        return 'Workflow execution failed';
                                      })()}
                                    </span>
                                  </>
                                )}
                            </>
                          )}
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                          {['queued', 'running'].includes(execution.status) && (
                            <button
                              className="p-1 rounded border border-black/20 hover:bg-gray-100"
                              title="Cancel execution"
                              onClick={e => {
                                e.stopPropagation();
                                setPendingAction({
                                  type: 'cancel',
                                  executionId: execution.execution_id,
                                });
                                setConfirmOpen(true);
                              }}
                            >
                              <Square className="w-4 h-4 text-gray-700" />
                            </button>
                          )}
                          <button
                            className="p-1 rounded border border-black/20 hover:bg-gray-100"
                            title="Delete execution"
                            onClick={e => {
                              e.stopPropagation();
                              const isActive = ['queued', 'running'].includes(
                                execution.status
                              );
                              setPendingAction({
                                type: isActive ? 'cancelDelete' : 'delete',
                                executionId: execution.execution_id,
                              });
                              setConfirmOpen(true);
                            }}
                          >
                            <Trash2 className="w-4 h-4 text-gray-700" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      {/* Batch Test Dialog */}
      <BatchTestDialog
        workflow={workflow}
        open={showBatchTestDialog}
        onOpenChange={setShowBatchTestDialog}
        onSubmit={onBatchSubmit}
      />

      {/* Workflow Settings Modal */}
      <UnifiedWorkflowDialog
        workflow={workflow}
        open={showUnifiedDialog}
        onOpenChange={setShowUnifiedDialog}
        onSettingsUpdated={onBatchSubmit} // Refresh workflow data after settings change
        onUseAsTemplate={(yaml, name) => {
          setTemplateYaml(yaml);
          setTemplateName(name);
          setShowCreateDialog(true);
        }}
      />

      {/* Create Workflow Dialog with Template */}
      <CreateWorkflowDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        initialYaml={templateYaml}
        initialName={templateName}
        onWorkflowCreated={() => {
          setShowCreateDialog(false);
          onBatchSubmit?.(); // Refresh the workflow list
        }}
      />

      {/* Confirm Dialog for Cancel/Delete */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.type === 'cancel' && 'Cancel execution?'}
              {pendingAction?.type === 'delete' && 'Delete execution?'}
              {pendingAction?.type === 'cancelDelete' &&
                'Cancel and delete execution?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.type === 'cancel' &&
                'This will stop the running execution.'}
              {pendingAction?.type === 'delete' &&
                'This will permanently remove the execution from history.'}
              {pendingAction?.type === 'cancelDelete' &&
                'The execution is active. We will cancel it and remove it from history.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={actionLoading}>
              {actionLoading ? 'Working...' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Workflow Dialog - Admin only */}
      <DeleteWorkflowDialog
        workflow={workflow}
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteWorkflow}
        isDeleting={deletingWorkflow}
      />

      {/* Workflow Actions Dialog (Rename/Duplicate) */}
      <WorkflowActionsDialog
        open={actionsDialogOpen}
        onOpenChange={setActionsDialogOpen}
        mode={actionsDialogMode}
        workflowId={workflow.id}
        currentName={workflow.name}
        currentDescription={workflow.description}
        onSuccess={() => {
          setActionsDialogOpen(false);
          if (onBatchSubmit) {
            onBatchSubmit();
          }
        }}
      />
    </Card>
  );
}
