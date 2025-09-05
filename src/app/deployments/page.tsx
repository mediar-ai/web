'use client';

import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialog';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowCard } from '@/components/deployments/WorkflowCard';
import { WorkflowDetailsDialog } from '@/components/deployments/WorkflowDetailsDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import {
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { SignIn, useAuth, useOrganization, useUser } from '@clerk/nextjs';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================================
// Components
// ============================================================================

/**
 * Animated indicator showing real-time value changes
 * Displays a floating badge that appears when values increase/decrease
 */
const LiveValueChangeIndicator = ({ value }: { value: number }) => {
  const [activeDeltas, setActiveDeltas] = useState<
    { id: string; value: number }[]
  >([]);

  useEffect(() => {
    if (value !== 0) {
      const newDelta = { id: `${Date.now()}-${Math.random()}`, value };
      setActiveDeltas(currentDeltas => [...currentDeltas, newDelta]);

      // Remove delta after animation completes
      setTimeout(() => {
        setActiveDeltas(currentDeltas =>
          currentDeltas.filter(delta => delta.id !== newDelta.id)
        );
      }, 2000);
    }
  }, [value]);

  if (activeDeltas.length === 0) return null;

  return (
    <>
      {activeDeltas.map(delta => (
        <span
          key={delta.id}
          className={`absolute -top-2 -right-6 px-2 py-1 text-sm font-bold rounded-full animate-bounce-in-out ${
            delta.value > 0
              ? 'bg-green-500 text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {delta.value > 0 ? `+${delta.value}` : delta.value}
        </span>
      ))}
    </>
  );
};

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
      <div className="stable-container py-4">
        <div>Loading...</div>
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
  const allowedUserIds = ['user_REDACTED']; // Louis's user ID
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

  // -------------------------------------------------------------------------
  // Loading States
  // -------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingExecutionId, setLoadingExecutionId] = useState<number | null>(
    null
  );
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
        setWorkflows(workflowData.workflows || []);
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
      <div className="flex items-center justify-center h-64">
        <div className="text-xl font-mono">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="stable-container p-6 space-y-6">
      {/* ===================================================================
          Page Header
          =================================================================== */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Remote Workflow Execution</h1>
          <p className="text-muted-foreground text-lg">
            Execute and monitor automated workflows remotely
          </p>

          <div className="mt-2">
            <span
              className={`text-sm font-medium ${
                isAdmin ? 'text-blue-600' : 'text-green-600'
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

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={() => setCreateWorkflowOpen(true)}
            size="default"
            className="text-white text-base font-mono"
          >
            <span className="mr-2">+</span>
            Create New Workflow
          </Button>

          <Button
            onClick={() => window.open('/docs/api/remote-workflows', '_blank')}
            variant="outline"
            size="default"
            className="bg-white text-black border-black hover:bg-black hover:text-white text-base font-mono cursor-pointer"
          >
            API DOCS
          </Button>

          <Button
            onClick={() => window.open('/docs/api/mcp', '_blank')}
            variant="outline"
            size="default"
            className="bg-white text-black border-black hover:bg-black hover:text-white text-base font-mono cursor-pointer"
          >
            MCP DOCS
          </Button>
        </div>
      </div>

      {/* ===================================================================
          Key Metrics Dashboard
          =================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-base font-mono text-black">
                AVAILABLE WORKFLOWS
              </p>
              <p className="relative inline-block text-4xl font-mono font-bold text-black">
                {workflows.length}
                <LiveValueChangeIndicator
                  value={workflows.length - previousWorkflows.current.length}
                />
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===================================================================
          Dialogs
          =================================================================== */}
      <WorkflowDetailsDialog
        workflow={selectedWorkflow}
        open={workflowDetailsOpen}
        onOpenChange={setWorkflowDetailsOpen}
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
        <h2 className="text-2xl font-bold font-mono mb-4">
          AVAILABLE WORKFLOWS
        </h2>

        <div className="grid gap-4">
          {workflows.map(workflow => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              executions={executions}
              liveExecutions={liveExecutions}
              executingWorkflows={executingWorkflows}
              onFetchWorkflowDetails={fetchWorkflowOverview}
              onFetchExecutionDetails={fetchExecutionDetails}
              loadingDetails={loadingDetails}
              loadingExecutionId={loadingExecutionId}
              loadingExecutions={loadingExecutions}
              isAdmin={canDelete}
              onBatchSubmit={() => {
                // Force immediate refresh when workflows are modified
                console.log('🔄 Refreshing workflows list...');
                fetchWorkflows(false);
              }}
            />
          ))}
        </div>
      </div>

      {/* ===================================================================
          Create Workflow Dialog
          =================================================================== */}
      <CreateWorkflowDialog
        open={createWorkflowOpen}
        onOpenChange={setCreateWorkflowOpen}
        onWorkflowCreated={handleWorkflowCreated}
      />
    </div>
  );
}
