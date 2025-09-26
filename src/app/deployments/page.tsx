'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialogImproved';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowCardEnhanced } from '@/components/deployments/WorkflowCardEnhanced';
import { UnifiedWorkflowDialog } from '@/components/deployments/UnifiedWorkflowDialog';
import { CommandPalette } from '@/components/deployments/CommandPalette';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { WorkflowActionsDialog } from '@/components/deployments/WorkflowActionsDialog';
import { BatchTestDialog } from '@/components/deployments/BatchTestDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import {
  Execution,
  LiveExecutionStatus,
  Workflow,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { SignIn, useAuth, useOrganization, useUser } from '@clerk/nextjs';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Eye, StopCircle, Trash2, PlayCircle, Plus } from 'lucide-react';

export default function DeploymentsPage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="p-6">
          <Skeleton className="h-10 w-64 mb-4" />
          <Skeleton className="h-32 w-full" />
        </div>
      </DashboardLayout>
    }>
      <DeploymentsPageContent />
    </Suspense>
  );
}

function DeploymentsPageContent() {
  const { isLoaded, userId, has } = useAuth();
  const { user } = useUser();
  const { organization, membership } = useOrganization();
  const searchParams = useSearchParams();

  // State
  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOverview | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [executionWorkflowFilter, setExecutionWorkflowFilter] = useState<number | "all">("all");
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  const [batchTestOpen, setBatchTestOpen] = useState(false);
  const [selectedWorkflowForAction, setSelectedWorkflowForAction] = useState<WorkflowWithSettings | null>(null);

  // Use keyboard navigation
  useKeyboardNavigation({
    isEnabled: true,
    totalItems: workflows.length,
    selectedIndex,
    onNavigate: setSelectedIndex,
    onEnter: () => {
      if (selectedIndex >= 0 && selectedIndex < workflows.length) {
        handleQuickExecute(workflows[selectedIndex].id);
      }
    },
    onDelete: () => {
      if (selectedIndex >= 0 && selectedIndex < workflows.length) {
        handleDeleteWorkflow(workflows[selectedIndex].id);
      }
    }
  });

  // Keyboard shortcut for new workflow (N key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
          return;
        }
        e.preventDefault();
        setCreateWorkflowOpen(true);
      }
      // Cmd+K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch functions
  const fetchWorkflows = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const response = await fetch("/api/remote-workflows/list");
      const workflowData = await response.json();
      if (workflowData.success) {
        const sortedWorkflows = (workflowData.workflows || []).sort(
          (a: WorkflowWithSettings, b: WorkflowWithSettings) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return dateA - dateB;
          }
        );
        setWorkflows(sortedWorkflows);
      }
    } catch (error) {
      console.error("Failed to fetch workflows:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const fetchExecutions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      const response = await fetch("/api/remote-workflows/executions");
      const executionData = await response.json();
      if (executionData.success) {
        setExecutions(executionData.executions || []);
      }
    } catch (error) {
      console.error("Failed to fetch executions:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const fetchLiveExecutions = useCallback(async () => {
    try {
      const response = await fetch("/api/remote-workflows/live-executions");
      const liveData = await response.json();
      if (liveData.success) {
        setLiveExecutions(liveData.executions || []);
      }
    } catch (error) {
      console.error("Failed to fetch live executions:", error);
    }
  }, []);

  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/overview`);
      const data = await response.json();
      if (data.success) {
        setSelectedWorkflow(data.overview);
        setWorkflowDetailsOpen(true);
      }
    } catch (error) {
      console.error("Failed to fetch workflow overview:", error);
    }
  }, []);

  const fetchExecutionDetails = useCallback(async (executionId: number) => {
    try {
      const response = await fetch(`/api/remote-workflows/executions/${executionId}`);
      const data = await response.json();
      if (data.success) {
        setSelectedExecution(data.execution);
        setExecutionDetailsOpen(true);
      }
    } catch (error) {
      console.error("Failed to fetch execution details:", error);
    }
  }, []);

  // Handlers
  const handleWorkflowCreated = useCallback((newWorkflow: any) => {
    console.log("New workflow created:", newWorkflow);
    fetchWorkflows(false);
  }, [fetchWorkflows]);

  const handleQuickExecute = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForAction(workflow);
    setActionsDialogOpen(true);
  }, [workflows]);

  const handleQuickEdit = useCallback(async (workflowId: number) => {
    fetchWorkflowOverview(workflowId);
  }, [fetchWorkflowOverview]);

  const handleQuickDuplicate = useCallback(async (workflowId: number) => {
    // Implementation for duplicate
    console.log("Duplicate workflow:", workflowId);
  }, []);

  const handleDeleteWorkflow = useCallback(async (workflowId: number) => {
    if (!confirm("Are you sure you want to delete this workflow?")) return;

    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/delete`, {
        method: "DELETE"
      });

      if (response.ok) {
        await fetchWorkflows(false);
      }
    } catch (error) {
      console.error("Failed to delete workflow:", error);
    }
  }, [fetchWorkflows]);

  const handleToggleCron = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/toggle-cron`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !workflow.cron_enabled })
      });

      if (response.ok) {
        await fetchWorkflows(false);
      }
    } catch (error) {
      console.error("Failed to toggle cron:", error);
    }
  }, [workflows, fetchWorkflows]);

  // Initial data loading
  useEffect(() => {
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions]);

  // Polling
  useEffect(() => {
    const pollTimer = setInterval(() => {
      fetchLiveExecutions();
      fetchExecutions(false);
    }, 2000);

    return () => clearInterval(pollTimer);
  }, [fetchLiveExecutions, fetchExecutions]);

  // Handle URL parameters for deep linking
  useEffect(() => {
    if (loading) return;

    const executionId = searchParams.get("execution");
    const workflowId = searchParams.get("workflow");

    if (executionId) {
      const execId = parseInt(executionId);
      if (!isNaN(execId) && !executionDetailsOpen) {
        fetchExecutionDetails(execId);
      }
    } else if (workflowId) {
      const wfId = parseInt(workflowId);
      if (!isNaN(wfId) && !selectedWorkflow) {
        const workflow = workflows.find(w => w.id === wfId);
        if (workflow) {
          fetchWorkflowOverview(wfId);
        }
      }
    }
  }, [loading, searchParams, executionDetailsOpen, selectedWorkflow, workflows, fetchExecutionDetails, fetchWorkflowOverview]);

  // Loading state
  if (!isLoaded) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Skeleton className="h-10 w-64 mb-4" />
          <Skeleton className="h-32 w-full" />
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

  const hasAdminRole = has({ role: "org:admin" });
  const hasMemberRole = has({ role: "org:member" });
  const canDelete = hasAdminRole || hasMemberRole;
  const isAdmin = hasAdminRole;
  const organizationName = organization?.name;

  // Filter executions
  const filteredExecutions = executionWorkflowFilter === "all"
    ? executions
    : executions.filter(e => e.workflow_id === executionWorkflowFilter);

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-mono">Remote Workflow Execution</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Execute and monitor automated workflows remotely
            </p>
            <div className="mt-2">
              <span className={`text-sm font-medium ${isAdmin ? "text-black font-bold" : "text-gray-600"}`}>
                {isAdmin && organizationName
                  ? `Admin - ${organizationName}`
                  : organizationName
                    ? `Member - ${organizationName}`
                    : "Organization Access"}
              </span>
            </div>
          </div>

          <Button
            onClick={() => setCreateWorkflowOpen(true)}
            className="bg-black text-white hover:bg-gray-800"
          >
            <Plus className="w-4 h-4 mr-2" />
            NEW WORKFLOW
          </Button>
        </div>

        {/* Workflows List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold font-mono uppercase">Available Workflows</h2>
            <span className="text-xs text-gray-500">Press N to create new workflow</span>
          </div>

          {loading ? (
            <div className="grid gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : workflows.length > 0 ? (
            <div className="grid gap-4">
              {workflows.map((workflow, index) => (
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
          ) : (
            <div className="text-center py-12 border-2 border-dashed border-black">
              <p className="font-mono text-gray-600 mb-4">No workflows created yet</p>
              <Button
                onClick={() => setCreateWorkflowOpen(true)}
                className="bg-black text-white hover:bg-gray-800"
              >
                <Plus className="w-4 h-4 mr-2" />
                CREATE YOUR FIRST WORKFLOW
              </Button>
            </div>
          )}
        </div>

        {/* Recent Executions */}
        {executions.length > 0 && (
          <div className="space-y-4 mt-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold font-mono uppercase">
                  Recent Executions
                  {executionWorkflowFilter !== "all" && (
                    <span className="ml-2 text-sm font-normal text-gray-600">
                      ({workflows.find(w => w.id === executionWorkflowFilter)?.name})
                    </span>
                  )}
                </h2>
              </div>

              <select
                value={executionWorkflowFilter}
                onChange={e => setExecutionWorkflowFilter(
                  e.target.value === "all" ? "all" : parseInt(e.target.value)
                )}
                className="px-3 py-1 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="all">All Workflows</option>
                {workflows.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div className="border-2 border-black">
              <table className="w-full">
                <thead className="bg-black text-white">
                  <tr>
                    <th className="text-left p-3 font-mono">Workflow</th>
                    <th className="text-left p-3 font-mono">Status</th>
                    <th className="text-left p-3 font-mono">Started</th>
                    <th className="text-left p-3 font-mono">Duration</th>
                    <th className="text-left p-3 font-mono">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExecutions.slice(0, 10).map(execution => (
                    <tr key={execution.id} className="border-t border-gray-200 hover:bg-gray-50">
                      <td className="p-3 font-mono text-sm">
                        {workflows.find(w => w.id === execution.workflow_id)?.name}
                      </td>
                      <td className="p-3">
                        <span className={`font-mono text-xs px-2 py-1 ${
                          execution.status === "completed" ? "bg-white border-2 border-black" :
                          execution.status === "failed" ? "bg-black text-white" :
                          execution.status === "running" ? "bg-white border-2 border-black animate-pulse" :
                          "bg-gray-100 border border-gray-300"
                        }`}>
                          {execution.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-sm">
                        {new Date(execution.started_at).toLocaleString()}
                      </td>
                      <td className="p-3 font-mono text-sm">
                        {execution.completed_at
                          ? `${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`
                          : "-"}
                      </td>
                      <td className="p-3">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => fetchExecutionDetails(execution.id)}
                          className="font-mono text-xs hover:bg-black hover:text-white"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Dialogs */}
        <CreateWorkflowDialog
          isOpen={createWorkflowOpen}
          onClose={() => setCreateWorkflowOpen(false)}
          onWorkflowCreated={handleWorkflowCreated}
        />

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

        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          workflows={workflows}
          onSelectWorkflow={(workflow) => {
            fetchWorkflowOverview(workflow.id);
            setCommandPaletteOpen(false);
          }}
        />

        {selectedWorkflowForAction && (
          <WorkflowActionsDialog
            workflow={selectedWorkflowForAction}
            open={actionsDialogOpen}
            onOpenChange={setActionsDialogOpen}
            onExecute={() => {
              setBatchTestOpen(true);
              setActionsDialogOpen(false);
            }}
          />
        )}

        {selectedWorkflowForAction && (
          <BatchTestDialog
            workflow={selectedWorkflowForAction}
            open={batchTestOpen}
            onOpenChange={setBatchTestOpen}
            onComplete={() => {
              fetchExecutions();
              setBatchTestOpen(false);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}