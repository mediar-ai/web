'use client';

import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialogImproved';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowCardEnhanced } from '@/components/deployments/WorkflowCardEnhanced';
import { UnifiedWorkflowDialog } from '@/components/deployments/UnifiedWorkflowDialog';
import { CommandPalette } from '@/components/deployments/CommandPalette';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { WorkflowActionsDialog } from '@/components/deployments/WorkflowActionsDialog';
import { BatchTestDialog } from '@/components/deployments/BatchTestDialog';
import { DeploymentSidebar } from '@/components/deployments/DeploymentSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useExecutionMonitoring } from '@/hooks/useExecutionMonitoring';

import {
  Execution,
  LiveExecutionStatus,
  Workflow,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { SignIn, useAuth, useOrganization, useUser } from '@clerk/nextjs';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, StopCircle, Trash2, PlayCircle } from 'lucide-react';

// ============================================================================
// Components
// ============================================================================

/**
 * Animated indicator showing real-time value changes
 * Displays a floating badge that appears when values increase/decrease
 */
// const LiveValueChangeIndicator = ({ value }: { value: number }) => {
//   const [activeDeltas, setActiveDeltas] = useState<
//     { id: string; value: number }[]
//   >([]);

//   useEffect(() => {
//     if (value !== 0) {
//       const newDelta = { id: `${Date.now()}-${Math.random()}`, value };
//       setActiveDeltas(currentDeltas => [...currentDeltas, newDelta]);

//       // Remove delta after animation completes
//       setTimeout(() => {
//         setActiveDeltas(currentDeltas =>
//           currentDeltas.filter(delta => delta.id !== newDelta.id)
//         );
//       }, 2000);
//     }
//   }, [value]);

//   if (activeDeltas.length === 0) return null;

//   return (
//     <>
//       {activeDeltas.map(delta => (
//         <span
//           key={delta.id}
//           className={`absolute -top-2 -right-6 px-2 py-1 text-sm font-bold rounded-full animate-bounce-in-out ${
//             delta.value > 0
//               ? 'bg-black text-white'
//               : 'bg-white text-black border-2 border-black'
//           }`}
//         >
//           {delta.value > 0 ? `+${delta.value}` : delta.value}
//         </span>
//       ))}
//     </>
//   );
// };

// ============================================================================
// Main Page Component
// ============================================================================

export default function WorkflowsPage() {
  // -------------------------------------------------------------------------
  // Authentication Hooks
  // -------------------------------------------------------------------------
  const { isLoaded, userId, has } = useAuth();
  const { user } = useUser();
  const { organization, membership } = useOrganization();

  // -------------------------------------------------------------------------
  // Loading State
  // -------------------------------------------------------------------------
  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-white p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Authentication Check
  // -------------------------------------------------------------------------
  if (!userId) {
    return (
      <div className="stable-container py-4 flex justify-center">
        <SignIn />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Authorization and Permissions
  // -------------------------------------------------------------------------
  const hasAdminRole = has({ role: 'org:admin' });
  const hasMemberRole = has({ role: 'org:member' });

  // Debug: log all available user data
  console.log('🔍 User object:', user);
  console.log('🔍 User email addresses:', user?.emailAddresses);

  const userEmail =
    user?.emailAddresses?.[0]?.emailAddress ||
    user?.primaryEmailAddress?.emailAddress ||
    '';

  // Temporary: Allow based on userId for testing since email detection isn't working
  const allowedUserIds = ['user_2yydAO45WOB4RaCE4F4BNUPtw9c']; // Louis's user ID
  const canDeleteWorkflows =
    ['louis@mediar.ai', 'matt@mediar.ai'].includes(userEmail.toLowerCase()) ||
    allowedUserIds.includes(userId || '');

  console.log(
    `🔐 Current user: ${userEmail}, UserID: ${userId}, Can delete: ${canDeleteWorkflows}`
  );

  // -------------------------------------------------------------------------
  // Access Control
  // -------------------------------------------------------------------------
  if (!hasAdminRole && !hasMemberRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">
            You need admin or member privileges to access deployments.
          </p>
          <Link href="/admin">
            <Button variant="outline">Return to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Pass authentication context to the main component
  return (
    <AuthenticatedDeploymentsPage
      isAdmin={hasAdminRole}
      canDelete={canDeleteWorkflows}
      userEmail={userEmail}
      organizationName={organization?.name}
      userRole={membership?.role}
    />
  );
}

// ============================================================================
// Authenticated Deployments Page
// ============================================================================

interface AuthenticatedDeploymentsPageProps {
  isAdmin: boolean;
  canDelete: boolean;
  userEmail: string;
  organizationName?: string;
  userRole?: string;
}

function AuthenticatedDeploymentsPage({
  isAdmin,
  canDelete,
  organizationName,
  userRole,
}: AuthenticatedDeploymentsPageProps) {
  // -------------------------------------------------------------------------
  // Core State - Workflows and Executions
  // -------------------------------------------------------------------------
  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>(
    []
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(
    new Set()
  );

  // -------------------------------------------------------------------------
  // Live Statistics State
  // -------------------------------------------------------------------------
  const [liveStats, setLiveStats] = useState({
    total_active: 0,
    running: 0,
    queued: 0,
    average_progress: 0,
  });

  // -------------------------------------------------------------------------
  // UI State - Dialogs and Loading
  // -------------------------------------------------------------------------
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowOverview | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(
    null
  );
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [templateYaml, setTemplateYaml] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  const [actionsDialogMode, setActionsDialogMode] = useState<'rename' | 'duplicate' | null>(null);
  const [selectedWorkflowForAction, setSelectedWorkflowForAction] = useState<WorkflowWithSettings | null>(null);
  const [executionDialogOpen, setExecutionDialogOpen] = useState(false);
  const [selectedWorkflowForExecution, setSelectedWorkflowForExecution] = useState<Workflow | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState<string>('all');
  const [executionWorkflowFilter, setExecutionWorkflowFilter] = useState<number | 'all'>('all');

  // -------------------------------------------------------------------------
  // Keyboard Navigation
  // -------------------------------------------------------------------------
  const { selectedIndex, setSelectedIndex } = useKeyboardNavigation({
    itemCount: workflows.length,
    onSelect: (index) => console.log('Selected workflow index:', index),
    onEnter: (index) => {
      if (workflows[index]) {
        fetchWorkflowOverview(workflows[index].id);
      }
    },
    isActive: !createWorkflowOpen && !workflowDetailsOpen,
  });

  // -------------------------------------------------------------------------
  // Loading States
  // -------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingDetails, setLoadingDetails] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingExecutionId, setLoadingExecutionId] = useState<number | null>(
    null
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [loadingExecutions, setLoadingExecutions] = useState(true);

  // -------------------------------------------------------------------------
  // Previous Values for Delta Calculations
  // -------------------------------------------------------------------------
  const previousWorkflows = useRef<WorkflowWithSettings[]>([]);
  const previousLiveStats = useRef({
    total_active: 0,
    running: 0,
    queued: 0,
    average_progress: 0,
  });

  // =========================================================================
  // Data Fetching Functions
  // =========================================================================

  /**
   * Fetches the list of available workflows
   */
  const fetchWorkflows = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await fetch('/api/remote-workflows/list');
      const workflowData = await response.json();
      if (workflowData.success) {
        // Sort workflows for consistent order
        const sortedWorkflows = (workflowData.workflows || []).sort((a: WorkflowWithSettings, b: WorkflowWithSettings) => {
          // Sort by name first (case-insensitive), then by ID for stability
          const nameCompare = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          if (nameCompare !== 0) return nameCompare;
          // If names are identical (unlikely), sort by ID
          return a.id - b.id;
        });
        setWorkflows(sortedWorkflows);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * Handles successful workflow creation
   */
  const handleWorkflowCreated = useCallback(
    (newWorkflow: any) => {
      console.log('🎉 New workflow created:', newWorkflow);
      // Refresh the workflows list to show the new workflow
      fetchWorkflows(false);
    },
    [fetchWorkflows]
  );

  /**
   * Handle workflow quick actions from enhanced UI
   */
  const handleQuickExecute = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForExecution(workflow);
    setExecutionDialogOpen(true);
  }, [workflows]);

  const handleQuickDuplicate = useCallback((workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForAction(workflow);
    setActionsDialogMode('duplicate');
    setActionsDialogOpen(true);
  }, [workflows]);

  const handleQuickEdit = useCallback((workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForAction(workflow);
    setActionsDialogMode('rename');
    setActionsDialogOpen(true);
  }, [workflows]);

  const handleToggleCron = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/cron`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: !workflow.cron_enabled,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh workflows to show updated state
        fetchWorkflows(false);
      } else {
        console.error('Failed to toggle cron:', result.error);
      }
    } catch (error) {
      console.error('Error toggling cron:', error);
    }
  }, [workflows, fetchWorkflows]);

  const handleDeleteWorkflow = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${workflow.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        // Refresh workflows list
        fetchWorkflows(false);
      } else {
        console.error('Failed to delete workflow:', result.error);
      }
    } catch (error) {
      console.error('Error deleting workflow:', error);
    }
  }, [workflows, fetchWorkflows]);

  /**
   * Fetches detailed workflow overview for viewing
   */
  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    try {
      setLoadingDetails(true);
      const response = await fetch(
        `/api/remote-workflows/${workflowId}/overview`
      );
      const overviewData = await response.json();
      if (response.ok && overviewData.success) {
        setSelectedWorkflow(overviewData.workflow);
        setWorkflowDetailsOpen(true);
      }
    } catch (error) {
      console.error('Failed to fetch workflow overview:', error);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  /**
   * Fetches detailed execution data for a specific run
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fetchExecutionDetails = useCallback(async (executionId: number) => {
    try {
      setLoadingDetails(true);
      setLoadingExecutionId(executionId);

      // Open the dialog immediately to show loading skeleton
      setSelectedExecution(null);
      setExecutionDetailsOpen(true);

      const response = await fetch(
        `/api/remote-workflows/executions/${executionId}?full_detailed_response=true`
      );
      const executionData = await response.json();
      if (executionData.success) {
        setSelectedExecution(executionData.execution);
      }
    } catch (error) {
      console.error('Failed to fetch execution details:', error);
      // Close dialog on error
      setExecutionDetailsOpen(false);
    } finally {
      setLoadingDetails(false);
      setLoadingExecutionId(null);
    }
  }, []);

  /**
   * Fetches historical execution records
   */
  const fetchExecutions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoadingExecutions(true);
      }
      // Fetch more executions to avoid truncating history when multiple workflows are active
      const response = await fetch(
        '/api/remote-workflows/executions?limit=1000'
      );
      const executionsData = await response.json();
      if (executionsData.success) {
        setExecutions(executionsData.executions || []);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      setExecutions([]);
    } finally {
      if (showLoading) {
        setLoadingExecutions(false);
      }
    }
  }, []);

  /**
   * Fetches currently running/active executions
   */
  const fetchLiveExecutions = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/remote-workflows/executions/live?status=active&limit=500'
      );

      if (!response.ok) {
        // API endpoint might not be available yet (migration not run)
        setLiveExecutions([]);
        setLiveStats({
          total_active: 0,
          running: 0,
          queued: 0,
          average_progress: 0,
        });
        return;
      }

      const liveData = await response.json();
      if (liveData.success && liveData.data) {
        setLiveExecutions(liveData.data.executions || []);
        setLiveStats(
          liveData.data.summary || {
            total_active: 0,
            running: 0,
            queued: 0,
            average_progress: 0,
          }
        );
      } else {
        setLiveExecutions([]);
        setLiveStats({
          total_active: 0,
          running: 0,
          queued: 0,
          average_progress: 0,
        });
      }
    } catch (error) {
      console.error('Failed to fetch live executions:', error);
      setLiveExecutions([]);
      setLiveStats({
        total_active: 0,
        running: 0,
        queued: 0,
        average_progress: 0,
      });
    }
  }, []);

  // =========================================================================
  // Effects and Lifecycle
  // =========================================================================

  /**
   * Initial data load on component mount
   */
  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  /**
   * Real-time polling for execution status updates
   * Polls every 2 seconds for live updates
   */
  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;

    console.log('[POLLING] Starting 2-second polling for execution updates...');

    const pollExecutionStatus = () => {
      // Only fetch live executions and executions (not workflows) to minimize load
      fetchLiveExecutions();
      fetchExecutions(false); // false = don't show loading spinner
    };

    // Set up 2-second interval polling
    pollTimer = setInterval(pollExecutionStatus, 2000);

    return () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        console.log('[POLLING] Stopped polling');
      }
    };
  }, [fetchLiveExecutions, fetchExecutions]);

  /**
   * Track previous values for delta calculations
   */
  useEffect(() => {
    previousWorkflows.current = workflows;
    previousLiveStats.current = liveStats;
  }, [workflows, liveStats]);

  /**
   * Update currently executing workflows set
   */
  useEffect(() => {
    const currentlyExecuting = new Set<number>();
    liveExecutions.forEach(execution => {
      if (execution.status === 'running' || execution.status === 'queued') {
        currentlyExecuting.add(execution.workflow_id);
      }
    });
    setExecutingWorkflows(currentlyExecuting);
  }, [liveExecutions]);

  // Use execution monitoring hook to track errors and trigger alerts
  useExecutionMonitoring(executions, liveExecutions);

  // =========================================================================
  // Computed Values and Statistics
  // =========================================================================

  // Note: These statistics are calculated for potential future use
  // Currently only workflow count is displayed in the UI

  // =========================================================================
  // Render
  // =========================================================================

  if (loading) {
    return (
      <SidebarProvider>
        <div className="flex h-screen overflow-hidden">
          <DeploymentSidebar
            stats={{
              total: 0,
              running: 0,
              paused: 0,
              failed: 0,
              automated: 0,
            }}
            selectedFilter="all"
            onFilterChange={() => {}}
            onCreateWorkflow={() => {}}
            canViewAlerts={false}
          />
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="max-w-7xl mx-auto p-6 space-y-6">
              {/* Header skeleton */}
              <div className="flex items-start justify-between mb-6">
                <div className="space-y-2">
                  <Skeleton className="h-8 w-80" />
                  <Skeleton className="h-5 w-64" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>

              {/* Workflows section skeleton */}
              <div className="space-y-4">
                <Skeleton className="h-7 w-48" />
                <div className="grid gap-4">
                  <Card className="border border-gray-200">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-3 flex-1">
                          <Skeleton className="h-6 w-64" />
                          <Skeleton className="h-4 w-96" />
                          <div className="flex gap-2">
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-5 w-16" />
                          </div>
                        </div>
                        <Skeleton className="h-8 w-8 rounded" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border border-gray-200">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-3 flex-1">
                          <Skeleton className="h-6 w-48" />
                          <Skeleton className="h-4 w-80" />
                          <div className="flex gap-2">
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-5 w-28" />
                          </div>
                        </div>
                        <Skeleton className="h-8 w-8 rounded" />
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border border-gray-200">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div className="space-y-3 flex-1">
                          <Skeleton className="h-6 w-72" />
                          <Skeleton className="h-4 w-full" />
                          <div className="flex gap-2">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-5 w-20" />
                            <Skeleton className="h-5 w-32" />
                          </div>
                        </div>
                        <Skeleton className="h-8 w-8 rounded" />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SidebarProvider>
    );
  }

  // Calculate stats for sidebar
  const sidebarStats = {
    total: workflows.length,
    running: liveExecutions.filter(e => e.status === 'running').length,
    paused: workflows.filter(w => w.cron_expression && !w.cron_enabled).length,
    failed: executions.filter(e => e.status === 'failed').length,
    automated: workflows.filter(w => w.cron_expression).length,
  };

  // Filter workflows based on sidebar selection
  const filteredWorkflows = workflows.filter(workflow => {
    switch (sidebarFilter) {
      case 'manual':
        return !workflow.cron_expression;
      case 'automated':
        return workflow.cron_expression;
      case 'paused':
        return workflow.cron_expression && !workflow.cron_enabled;
      case 'active':
        return workflow.status === 'deployed' && (!workflow.cron_expression || workflow.cron_enabled);
      case 'failed':
        return executions.some(e => e.workflow_id === workflow.id && e.status === 'failed');
      case 'completed':
        return executions.some(e => e.workflow_id === workflow.id && e.status === 'completed');
      default:
        return true;
    }
  });

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <DeploymentSidebar
          stats={sidebarStats}
          selectedFilter={sidebarFilter}
          onFilterChange={setSidebarFilter}
          onCreateWorkflow={() => setCreateWorkflowOpen(true)}
          canViewAlerts={canDelete}
        />
        <div className="flex-1">
          <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* ===================================================================
          Page Header
          =================================================================== */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono">Remote Workflow Execution</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Execute and monitor automated workflows remotely
            </p>
            <div className="mt-2">
              <span
                className={`text-sm font-medium ${
                  isAdmin ? 'text-black font-bold' : 'text-gray-600'
                }`}
              >
                {isAdmin && organizationName
                  ? `Admin - ${organizationName}`
                  : organizationName
                    ? `Member - ${organizationName}`
                    : 'Organization Access'}
              </span>
              {userRole && (
                <span className="text-xs text-gray-500 ml-2">
                  Role: {userRole}
                </span>
              )}
            </div>
          </div>
      </div>


      {/* ===================================================================
          Dialogs
          =================================================================== */}
      <UnifiedWorkflowDialog
        workflow={selectedWorkflow}
        open={workflowDetailsOpen}
        onOpenChange={setWorkflowDetailsOpen}
        onSettingsUpdated={() => fetchWorkflows(false)}
      />

      <ExecutionDetailsDialog
        execution={selectedExecution}
        open={executionDetailsOpen}
        onOpenChange={setExecutionDetailsOpen}
      />

      {/* ===================================================================
          Workflows List
          =================================================================== */}
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold font-mono uppercase">
            Available Workflows
          </h2>
        </div>

        <div className="grid gap-4">
          {filteredWorkflows.map((workflow, index) => (
              <WorkflowCardEnhanced
                key={workflow.id}
                workflow={workflow}
                executions={executions.filter(e => e.workflow_id === workflow.id)}
                liveExecutions={liveExecutions}
                isSelected={selectedIndex === index}
                onSelect={() => setSelectedIndex(index)}
                onExecute={() => handleQuickExecute(workflow.id)}
                onView={() => fetchWorkflowOverview(workflow.id)}
                onDuplicate={() => handleQuickDuplicate(workflow.id)}
                onEdit={() => handleQuickEdit(workflow.id)}
                onDelete={() => handleDeleteWorkflow(workflow.id)}
                onToggleCron={() => handleToggleCron(workflow.id)}
              />
            ))}
        </div>
      </div>

      {/* ===================================================================
          Recent Executions
          =================================================================== */}
      {executions.length > 0 && (
        <div className="space-y-4 mt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-bold font-mono uppercase">
                Recent Executions
                {executionWorkflowFilter !== 'all' && (
                  <span className="ml-2 text-sm font-normal text-gray-600">
                    ({workflows.find(w => w.id === executionWorkflowFilter)?.name})
                  </span>
                )}
              </h2>
              {executions.some(e => e.status === 'queued') && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-2 border-black hover:bg-black hover:text-white"
                  onClick={async () => {
                    try {
                      const response = await fetch('/api/admin/process-queue', {
                        method: 'POST'
                      });
                      const data = await response.json();
                      if (response.ok) {
                        alert(`Processed ${data.processed.length} workflows`);
                        await fetchExecutions();
                        await fetchLiveExecutions();
                      } else {
                        alert(`Failed to process queue: ${data.error}`);
                      }
                    } catch (error) {
                      console.error('Error processing queue:', error);
                      alert('Failed to process queue');
                    }
                  }}
                  title="Manually process queued workflows"
                >
                  <PlayCircle className="w-4 h-4 mr-2" />
                  Process Queue
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={executionWorkflowFilter}
                onChange={(e) => setExecutionWorkflowFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                className="px-3 py-1 text-sm border border-black rounded font-mono bg-white hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="all">All Workflows</option>
                {workflows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              {executionWorkflowFilter !== 'all' && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExecutionWorkflowFilter('all')}
                  className="text-xs"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
          <div className="border border-black rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-black">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-mono uppercase">Workflow</th>
                  <th className="px-4 py-2 text-left text-xs font-mono uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-mono uppercase">Started</th>
                  <th className="px-4 py-2 text-left text-xs font-mono uppercase">Duration</th>
                  <th className="px-4 py-2 text-left text-xs font-mono uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {executions
                  .filter(e => executionWorkflowFilter === 'all' || e.workflow_id === executionWorkflowFilter)
                  .slice(0, 10)
                  .map((execution) => {
                  const workflow = workflows.find(w => w.id === execution.workflow_id);
                  const isLive = liveExecutions.some(le => le.id === execution.execution_id);
                  return (
                    <tr key={`execution-${execution.execution_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm font-mono">
                        {workflow?.name || `Workflow ${execution.workflow_id}`}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          execution.status === 'completed' ? 'bg-green-100 text-green-800' :
                          execution.status === 'failed' ? 'bg-red-100 text-red-800' :
                          execution.status === 'running' || isLive ? 'bg-yellow-100 text-yellow-800 animate-pulse' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {execution.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {new Date(execution.started_at || execution.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-sm font-mono">
                        {execution.completed_at && execution.started_at
                          ? `${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`
                          : isLive ? 'Running...' : '-'
                        }
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 border border-black hover:bg-black hover:text-white"
                            onClick={() => {
                              setSelectedExecution(execution);
                              setExecutionDetailsOpen(true);
                            }}
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {(execution.status === 'running' || execution.status === 'queued') && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 bg-black text-white hover:bg-gray-800"
                              onClick={async () => {
                                if (confirm(`Are you sure you want to ${execution.status === 'queued' ? 'cancel' : 'stop'} this execution?`)) {
                                  try {
                                    const response = await fetch(`/api/remote-workflows/executions/${execution.execution_id}/cancel`, {
                                      method: 'POST',
                                    });
                                    if (response.ok) {
                                      // Refresh executions
                                      await fetchExecutions();
                                      await fetchLiveExecutions();
                                    } else {
                                      const error = await response.json();
                                      console.error('Cancel failed:', error);
                                      alert(`Failed to cancel execution: ${error.error || 'Unknown error'}`);
                                    }
                                  } catch (error) {
                                    console.error('Error canceling execution:', error);
                                    alert('Error canceling execution');
                                  }
                                }
                              }}
                              title={execution.status === 'queued' ? 'Cancel' : 'Stop'}
                            >
                              <StopCircle className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 border border-black hover:bg-red-600 hover:text-white hover:border-red-600"
                            onClick={async () => {
                              if (confirm(`Are you sure you want to DELETE this execution? This cannot be undone.`)) {
                                try {
                                  const response = await fetch(`/api/remote-workflows/executions/${execution.execution_id}/delete`, {
                                    method: 'DELETE',
                                  });
                                  if (response.ok) {
                                    // Refresh executions
                                    await fetchExecutions();
                                    await fetchLiveExecutions();
                                  } else {
                                    const error = await response.json();
                                    console.error('Delete failed:', error);
                                    alert(`Failed to delete execution: ${error.error || 'Unknown error'}`);
                                  }
                                } catch (error) {
                                  console.error('Error deleting execution:', error);
                                  alert('Error deleting execution');
                                }
                              }
                            }}
                            title="Delete Execution"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

          </div>
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
          workflows={workflows}
          executions={executions}
          onExecuteWorkflow={handleQuickExecute}
          onDuplicateWorkflow={handleQuickDuplicate}
          onViewWorkflow={fetchWorkflowOverview}
          onEditWorkflow={handleQuickEdit}
          onViewExecution={(execution) => {
            setSelectedExecution(execution);
            setExecutionDetailsOpen(true);
          }}
          onCreateWorkflow={() => setCreateWorkflowOpen(true)}
          onRefresh={() => fetchWorkflows(true)}
      />

      {/* ===================================================================
          Workflow Actions Dialog (Rename/Duplicate)
          =================================================================== */}
      {selectedWorkflowForAction && (
        <WorkflowActionsDialog
          open={actionsDialogOpen}
          onOpenChange={setActionsDialogOpen}
          mode={actionsDialogMode}
          workflowId={selectedWorkflowForAction.id}
          currentName={selectedWorkflowForAction.name}
          currentDescription={selectedWorkflowForAction.description}
          onSuccess={() => {
            setActionsDialogOpen(false);
            fetchWorkflows(false);
          }}
        />
      )}

      <BatchTestDialog
        workflow={selectedWorkflowForExecution}
        open={executionDialogOpen}
        onOpenChange={setExecutionDialogOpen}
        onSubmit={() => {
          console.log('Test run started');
          fetchExecutions(false);
        }}
      />

      {/* ===================================================================
          Create Workflow Dialog
          =================================================================== */}
      <CreateWorkflowDialog
        open={createWorkflowOpen}
        onOpenChange={(open) => {
          setCreateWorkflowOpen(open);
          // Clear template data when closing
          if (!open) {
            setTemplateYaml('');
            setTemplateName('');
          }
        }}
        initialYaml={templateYaml}
        initialName={templateName}
        onWorkflowCreated={handleWorkflowCreated}
      />
    </SidebarProvider>
  );
}
