'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialogImproved';
import { WorkflowCardEnhanced } from '@/components/deployments/WorkflowCardEnhanced';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import {
  Execution,
  LiveExecutionStatus,
  Workflow,
} from '@/lib/workflow-types';
import { SignIn, useAuth, useOrganization } from '@clerk/nextjs';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Plus, Activity, PlayCircle, XCircle, Clock, Zap } from 'lucide-react';

export default function DeploymentsPage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      </DashboardLayout>
    }>
      <DeploymentsPageContent />
    </Suspense>
  );
}

function DeploymentsPageContent() {
  const { isLoaded, userId, has } = useAuth();
  useOrganization(); // For context
  useSearchParams(); // Will use for deep linking later

  // State
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);

  // Fetch workflows
  const fetchWorkflows = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await fetch('/api/remote-workflows/list');
      const workflowData = await response.json();
      if (workflowData.success) {
        const sortedWorkflows = (workflowData.workflows || []).sort(
          (a: Workflow, b: Workflow) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return dateA - dateB;
          }
        );
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

  // Fetch executions
  const fetchExecutions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      const response = await fetch('/api/remote-workflows/executions');
      const executionData = await response.json();
      if (executionData.success) {
        setExecutions(executionData.executions || []);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // Fetch live execution status
  const fetchLiveExecutions = useCallback(async () => {
    try {
      const response = await fetch('/api/remote-workflows/live-executions');
      const liveData = await response.json();
      if (liveData.success) {
        setLiveExecutions(liveData.executions || []);
      }
    } catch (error) {
      console.error('Failed to fetch live executions:', error);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  // Polling for live updates
  useEffect(() => {
    const pollTimer = setInterval(() => {
      fetchLiveExecutions();
      fetchExecutions(false);
    }, 2000);

    return () => {
      clearInterval(pollTimer);
    };
  }, [fetchLiveExecutions, fetchExecutions]);

  // Loading
  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
        </div>
      </DashboardLayout>
    );
  }

  // Auth check
  if (!userId) {
    return (
      <DashboardLayout>
        <div className="flex justify-center py-8">
          <SignIn />
        </div>
      </DashboardLayout>
    );
  }

  const hasAdminRole = has({ role: 'org:admin' });
  const hasMemberRole = has({ role: 'org:member' });
  const canDelete = hasAdminRole || hasMemberRole;

  // Calculate stats
  const stats = {
    total: workflows.length,
    running: liveExecutions.filter(e => e.status === 'running').length,
    paused: workflows.filter(w => w.cron_expression && !w.cron_enabled).length,
    failed: executions.filter(e => e.status === 'failed').length,
    automated: workflows.filter(w => w.cron_expression).length,
  };

  // Filter workflows based on selected filter
  const filteredWorkflows = workflows.filter(workflow => {
    switch (filter) {
      case 'running':
        return liveExecutions.some(e => e.workflow_id === workflow.id && e.status === 'running');
      case 'paused':
        return workflow.cron_expression && !workflow.cron_enabled;
      case 'failed':
        return executions.some(e => e.workflow_id === workflow.id && e.status === 'failed');
      case 'automated':
        return !!workflow.cron_expression;
      default:
        return true;
    }
  });

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Header with Stats and Actions */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-mono font-bold text-3xl mb-2">Deployments</h1>
              <p className="font-mono text-gray-600">Manage and monitor your workflow deployments</p>
            </div>
            <Button
              onClick={() => setCreateWorkflowOpen(true)}
              className="bg-black text-white hover:bg-gray-800"
            >
              <Plus className="w-4 h-4 mr-2" />
              NEW WORKFLOW
            </Button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mb-6">
            <Card
              className={`border-2 cursor-pointer transition-colors ${filter === 'all' ? 'border-black bg-black text-white' : 'border-black hover:bg-gray-50'}`}
              onClick={() => setFilter('all')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-mono font-bold">{stats.total}</p>
                    <p className="text-xs font-mono uppercase">Total</p>
                  </div>
                  <Activity className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-2 cursor-pointer transition-colors ${filter === 'running' ? 'border-black bg-black text-white' : 'border-black hover:bg-gray-50'}`}
              onClick={() => setFilter('running')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-mono font-bold">{stats.running}</p>
                    <p className="text-xs font-mono uppercase">Running</p>
                  </div>
                  <PlayCircle className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-2 cursor-pointer transition-colors ${filter === 'paused' ? 'border-black bg-black text-white' : 'border-black hover:bg-gray-50'}`}
              onClick={() => setFilter('paused')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-mono font-bold">{stats.paused}</p>
                    <p className="text-xs font-mono uppercase">Paused</p>
                  </div>
                  <Clock className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-2 cursor-pointer transition-colors ${filter === 'failed' ? 'border-black bg-black text-white' : 'border-black hover:bg-gray-50'}`}
              onClick={() => setFilter('failed')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-mono font-bold">{stats.failed}</p>
                    <p className="text-xs font-mono uppercase">Failed</p>
                  </div>
                  <XCircle className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>

            <Card
              className={`border-2 cursor-pointer transition-colors ${filter === 'automated' ? 'border-black bg-black text-white' : 'border-black hover:bg-gray-50'}`}
              onClick={() => setFilter('automated')}
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-mono font-bold">{stats.automated}</p>
                    <p className="text-xs font-mono uppercase">Automated</p>
                  </div>
                  <Zap className="w-5 h-5" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Workflows Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        ) : filteredWorkflows.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkflows.map(workflow => (
              <WorkflowCardEnhanced
                key={workflow.id}
                workflow={workflow}
                executions={executions.filter(e => e.workflow_id === workflow.id) || []}
                liveExecutions={liveExecutions}
                onExecute={() => {}}
                onView={() => {}}
                onDuplicate={() => {}}
                onEdit={() => {}}
                onDelete={() => {}}
                onToggleCron={() => {}}
              />
            ))}
          </div>
        ) : null}

        {/* Empty state */}
        {!loading && filteredWorkflows.length === 0 && (
          <div className="text-center py-12 border-2 border-dashed border-black">
            <p className="font-mono text-gray-600 mb-4">
              {filter === 'all'
                ? 'No workflows created yet'
                : `No ${filter} workflows`}
            </p>
            {filter === 'all' && (
              <Button
                onClick={() => setCreateWorkflowOpen(true)}
                className="bg-black text-white hover:bg-gray-800"
              >
                <Plus className="w-4 h-4 mr-2" />
                CREATE YOUR FIRST WORKFLOW
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateWorkflowDialog
        isOpen={createWorkflowOpen}
        onClose={() => setCreateWorkflowOpen(false)}
        onWorkflowCreated={() => {
          setCreateWorkflowOpen(false);
          fetchWorkflows(false);
        }}
      />
    </DashboardLayout>
  );
}