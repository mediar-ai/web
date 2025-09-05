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

// Floating Delta Component
const FloatingDelta = ({ value }: { value: number }) => {
  const [deltas, setDeltas] = useState<{ id: string; value: number }[]>([]);

  useEffect(() => {
    if (value !== 0) {
      const newDelta = { id: `${Date.now()}-${Math.random()}`, value };
      setDeltas(d => [...d, newDelta]);
      setTimeout(() => {
        setDeltas(d => d.filter(delta => delta.id !== newDelta.id));
      }, 2000); // Corresponds to animation duration
    }
  }, [value]);

  if (deltas.length === 0) return null;

  return (
    <>
      {deltas.map(delta => (
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

export default function WorkflowsPage() {
  const { isLoaded, userId, has } = useAuth();
  const { user } = useUser();
  const { organization, membership } = useOrganization();

  // Show loading while Clerk is initializing
  if (!isLoaded) {
    return (
      <div className="stable-container py-4">
        <div>Loading...</div>
      </div>
    );
  }

  // Show sign-in if not authenticated
  if (!userId) {
    return (
      <div className="stable-container py-4 flex justify-center">
        <SignIn />
      </div>
    );
  }

  // Check if user has required role for deployment access
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
    <AuthenticatedWorkflowsPage
      isAdmin={hasAdminRole}
      canDelete={canDeleteWorkflows}
      userEmail={userEmail}
      organizationName={organization?.name}
      userRole={membership?.role}
    />
  );
}

interface AuthenticatedWorkflowsPageProps {
  isAdmin: boolean;
  canDelete: boolean;
  userEmail: string;
  organizationName?: string;
  userRole?: string;
}

function AuthenticatedWorkflowsPage({
  isAdmin,
  canDelete,
  organizationName,
  userRole,
}: AuthenticatedWorkflowsPageProps) {
  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>(
    []
  );
  const [liveStats, setLiveStats] = useState({
    total_active: 0,
    running: 0,
    queued: 0,
    average_progress: 0,
  });
  const [loading, setLoading] = useState(true);
  const [executingWorkflows, setExecutingWorkflows] = useState<Set<number>>(
    new Set()
  );
  const previousWorkflows = useRef<WorkflowWithSettings[]>([]);
  const previousLiveStats = useRef({
    total_active: 0,
    running: 0,
    queued: 0,
    average_progress: 0,
  });

  // New state for enhanced UI
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowOverview | null>(null);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(
    null
  );
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingExecutionId, setLoadingExecutionId] = useState<number | null>(
    null
  );
  const [loadingExecutions, setLoadingExecutions] = useState(true);
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);

  // Simple polling implementation - no realtime dependencies needed

  // Fetch workflows
  const fetchWorkflows = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await fetch('/api/remote-workflows/list');
      const data = await response.json();
      if (data.success) {
        setWorkflows(data.workflows || []);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // Handle workflow creation
  const handleWorkflowCreated = useCallback(
    (newWorkflow: any) => {
      console.log('🎉 New workflow created:', newWorkflow);
      // Refresh the workflows list to show the new workflow
      fetchWorkflows(false);
    },
    [fetchWorkflows]
  );

  // Fetch detailed workflow overview
  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    try {
      setLoadingDetails(true);
      const response = await fetch(
        `/api/remote-workflows/${workflowId}/overview`
      );
      const data = await response.json();
      if (response.ok && data.success) {
        setSelectedWorkflow(data.workflow);
        setWorkflowDetailsOpen(true);
      }
    } catch (error) {
      console.error('Failed to fetch workflow overview:', error);
    } finally {
      setLoadingDetails(false);
    }
  }, []);

  // Fetch detailed execution data
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
      const data = await response.json();
      if (data.success) {
        setSelectedExecution(data.execution);
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

  // Fetch executions
  const fetchExecutions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoadingExecutions(true);
      }
      const response = await fetch('/api/remote-workflows/executions');
      const data = await response.json();
      if (data.success) {
        setExecutions(data.executions || []);
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

  // Fetch live executions
  const fetchLiveExecutions = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/remote-workflows/executions/live?status=active&limit=200'
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
      const data = await response.json();
      if (data.success && data.data) {
        setLiveExecutions(data.data.executions || []);
        setLiveStats(
          data.data.summary || {
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

  // Initial load
  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  // Simple 2-second polling for live execution updates
  useEffect(() => {
    let pollTimer: NodeJS.Timeout | null = null;

    console.log('[POLLING] Starting 2-second polling for execution updates...');

    const doPoll = () => {
      // Only fetch live executions and executions (not workflows) to minimize load
      fetchLiveExecutions();
      fetchExecutions(false); // false = don't show loading spinner
    };

    // Set up 2-second interval polling
    pollTimer = setInterval(doPoll, 2000);

    return () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        console.log('[POLLING] Stopped polling');
      }
    };
  }, [fetchLiveExecutions, fetchExecutions]);

  // Note: Removed complex realtime subscription setup - now using simple 2-second polling above

  useEffect(() => {
    previousWorkflows.current = workflows;
    previousLiveStats.current = liveStats;
  }, [workflows, liveStats]);

  useEffect(() => {
    const currentlyExecuting = new Set<number>();
    liveExecutions.forEach(exec => {
      if (exec.status === 'running' || exec.status === 'queued') {
        currentlyExecuting.add(exec.workflow_id);
      }
    });
    setExecutingWorkflows(currentlyExecuting);
  }, [liveExecutions]);

  // Calculate stats using deployed version data (current_version_stats) instead of overall historical data
  const totalExecutions = workflows.reduce(
    (total, workflow) =>
      total + (workflow.current_version_stats?.total_executions || 0),
    0
  );
  const prevTotalExecutions = previousWorkflows.current.reduce(
    (total, workflow) =>
      total + (workflow.current_version_stats?.total_executions || 0),
    0
  );

  const totalSuccessfulRuns = workflows.reduce(
    (acc, w) => acc + (w.current_version_stats?.successful_runs || 0),
    0
  );
  const successRate =
    totalExecutions > 0
      ? Math.round((totalSuccessfulRuns / totalExecutions) * 100)
      : 0;

  const prevTotalSuccessfulRuns = previousWorkflows.current.reduce(
    (acc, w) => acc + (w.current_version_stats?.successful_runs || 0),
    0
  );
  const prevSuccessRate =
    prevTotalExecutions > 0
      ? Math.round((prevTotalSuccessfulRuns / prevTotalExecutions) * 100)
      : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-xl font-mono">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="stable-container p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Remote Workflow Execution</h1>
          <p className="text-muted-foreground text-lg">
            Execute and monitor automated workflows remotely
          </p>
          <div className="mt-2">
            <span
              className={`text-sm font-medium ${isAdmin ? 'text-blue-600' : 'text-green-600'}`}
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
        <div className="flex gap-2">
          <Button
            onClick={() => setCreateWorkflowOpen(true)}
            size="default"
            className=" text-white  text-base font-mono"
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

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-black">
          <CardContent className="p-4">
            <div>
              <p className="text-base font-mono text-black">
                AVAILABLE WORKFLOWS
              </p>
              <p className="relative inline-block text-4xl font-mono font-bold text-black">
                {workflows.length}
                <FloatingDelta
                  value={workflows.length - previousWorkflows.current.length}
                />
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Details Dialog */}
      <WorkflowDetailsDialog
        workflow={selectedWorkflow}
        open={workflowDetailsOpen}
        onOpenChange={setWorkflowDetailsOpen}
      />

      {/* Execution Details Dialog */}
      <ExecutionDetailsDialog
        execution={selectedExecution}
        open={executionDetailsOpen}
        onOpenChange={setExecutionDetailsOpen}
      />

      {/* Available Workflows */}
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

      {/* Create Workflow Dialog */}
      <CreateWorkflowDialog
        open={createWorkflowOpen}
        onOpenChange={setCreateWorkflowOpen}
        onWorkflowCreated={handleWorkflowCreated}
      />
    </div>
  );
}
