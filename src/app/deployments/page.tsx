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
import { OrganizationAssignmentDialog } from '@/components/deployments/OrganizationAssignmentDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import {
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { SignIn, useAuth, useOrganization, useOrganizationList, useUser } from '@clerk/nextjs';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Eye, StopCircle, Trash2, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';

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
  const { organization } = useOrganization();
  const { userMemberships } = useOrganizationList();
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  // State
  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOverview | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [executionWorkflowFilter, setExecutionWorkflowFilter] = useState<number | "all">("all");
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  const [actionsDialogMode, setActionsDialogMode] = useState<'rename' | 'duplicate' | null>(null);
  const [batchTestOpen, setBatchTestOpen] = useState(false);
  const [selectedWorkflowForAction, setSelectedWorkflowForAction] = useState<WorkflowWithSettings | null>(null);
  const [templateYaml, setTemplateYaml] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [orgAssignmentOpen, setOrgAssignmentOpen] = useState(false);
  const [selectedWorkflowForOrgAssignment, setSelectedWorkflowForOrgAssignment] = useState<WorkflowWithSettings | null>(null);
  const [stoppingExecutions, setStoppingExecutions] = useState<Set<number>>(new Set());
  const [deletingExecutions, setDeletingExecutions] = useState<Set<number>>(new Set());

  // Use keyboard navigation
  const { selectedIndex: navSelectedIndex } = useKeyboardNavigation({
    itemCount: workflows.length,
    onSelect: index => setSelectedIndex(index),
    onEnter: index => {
      if (workflows[index]) {
        fetchWorkflowOverview(workflows[index].id);
      }
    },
    isActive: !createWorkflowOpen && !workflowDetailsOpen,
  });

  useEffect(() => {
    setSelectedIndex(navSelectedIndex);
  }, [navSelectedIndex]);

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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Fetch functions
  const fetchWorkflows = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      // Use viewOrgId from searchParams (passed from parent)
      const apiUrl = viewOrgId
        ? `/api/remote-workflows/list?viewOrgId=${viewOrgId}`
        : '/api/remote-workflows/list';
      const response = await fetch(apiUrl);
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
  }, [viewOrgId]);

  const fetchExecutions = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setExecutionsLoading(true);
      // Use viewOrgId from searchParams (passed from parent)
      const apiUrl = viewOrgId
        ? `/api/remote-workflows/executions?limit=50&include_results=true&viewOrgId=${viewOrgId}`
        : '/api/remote-workflows/executions?limit=50&include_results=true';
      const response = await fetch(apiUrl);
      const executionsData = await response.json();
      if (executionsData.success) {
        setExecutions(executionsData.executions || []);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      setExecutions([]);
    } finally {
      if (showLoading) setExecutionsLoading(false);
    }
  }, [viewOrgId]);

  const fetchLiveExecutions = useCallback(async () => {
    try {
      // Use viewOrgId from searchParams (passed from parent)
      const apiUrl = viewOrgId
        ? `/api/remote-workflows/executions/live?status=active&limit=500&viewOrgId=${viewOrgId}`
        : '/api/remote-workflows/executions/live?status=active&limit=500';
      const response = await fetch(apiUrl);
      if (!response.ok) {
        setLiveExecutions([]);
        return;
      }
      const liveData = await response.json();
      if (liveData.success && liveData.data) {
        setLiveExecutions(liveData.data.executions || []);
      } else {
        setLiveExecutions([]);
      }
    } catch (error) {
      console.error('Failed to fetch live executions:', error);
      setLiveExecutions([]);
    }
  }, [viewOrgId]);

  const fetchWorkflowOverview = useCallback(async (workflowId: number) => {
    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/overview`);
      const overviewData = await response.json();
      if (response.ok && overviewData.success) {
        setSelectedWorkflow(overviewData.workflow);
        setWorkflowDetailsOpen(true);
      }
    } catch (error) {
      console.error('Failed to fetch workflow overview:', error);
    }
  }, []);

  const fetchExecutionDetails = useCallback(async (executionId: number) => {
    try {
      setSelectedExecution(null);
      setExecutionDetailsOpen(true);
      const response = await fetch(`/api/remote-workflows/executions/${executionId}?full_detailed_response=true`);
      const executionData = await response.json();
      if (executionData.success) {
        setSelectedExecution(executionData.execution);
      }
    } catch (error) {
      console.error('Failed to fetch execution details:', error);
      setExecutionDetailsOpen(false);
    }
  }, []);

  // Handlers
  const handleWorkflowCreated = useCallback((_newWorkflow: any) => {
    fetchWorkflows(false);
  }, [fetchWorkflows]);

  const handleQuickExecute = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForAction(workflow);
    setBatchTestOpen(true);
  }, [workflows]);

  const _handleQuickEdit = useCallback((workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForAction(workflow);
    setActionsDialogMode('rename');
    setActionsDialogOpen(true);
  }, [workflows]);

  const handleQuickDuplicate = useCallback((workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForAction(workflow);
    setActionsDialogMode('duplicate');
    setActionsDialogOpen(true);
  }, [workflows]);

  const handleDeleteWorkflow = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    if (!confirm(`Are you sure you want to delete "${workflow.name}"?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (result.success) {
        fetchWorkflows(false);
      } else {
        console.error('Failed to delete workflow:', result.error);
      }
    } catch (error) {
      console.error('Error deleting workflow:', error);
    }
  }, [workflows, fetchWorkflows]);

  const handleToggleCron = useCallback(async (workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    try {
      const response = await fetch(`/api/remote-workflows/${workflowId}/cron`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !workflow.cron_enabled })
      });

      const result = await response.json();
      if (result.success) {
        fetchWorkflows(false);
      } else {
        console.error('Failed to toggle cron:', result.error);
      }
    } catch (error) {
      console.error('Error toggling cron:', error);
    }
  }, [workflows, fetchWorkflows]);

  const handleManageOrganizations = useCallback((workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForOrgAssignment(workflow);
    setOrgAssignmentOpen(true);
  }, [workflows]);

  // Initial data loading and refetch when viewOrgId changes
  useEffect(() => {
    console.log('[Deployments] viewOrgId changed to:', viewOrgId);
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions, viewOrgId]);

  // Polling (30 seconds, only when active)
  useEffect(() => {
    if (liveExecutions.length === 0) return; // Don't poll if nothing active

    let localPollCount = 0;
    const pollTimer = setInterval(() => {
      localPollCount++;
      fetchLiveExecutions();
      // Only fetch all executions every 5th poll
      if (localPollCount % 5 === 0) fetchExecutions(false);
    }, 30000);

    return () => clearInterval(pollTimer);
  }, [liveExecutions.length, fetchLiveExecutions, fetchExecutions]);

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

  // Check if user has @mediar.ai email OR is member of Mediar org
  const hasMediarEmail = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;

  // Check if user is member of any Mediar organization
  const isMemberOfMediarOrg = userMemberships?.data?.some(
    membership => MEDIAR_ORG_IDS.includes(membership.organization.id)
  ) || false;

  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isGlobalAdmin = hasMediarEmail || isMemberOfMediarOrg; // Either @mediar.ai email OR member of Mediar org
  const canDelete = isGlobalAdmin;
  const _isAdmin = hasAdminRole;

  // Debug logging for organization assignment feature
  console.log('[Deployments] Organization context:', {
    orgId: organization?.id,
    orgName: organization?.name,
    userEmail: user?.primaryEmailAddress?.emailAddress,
    hasMediarEmail,
    isMemberOfMediarOrg,
    isMediarOrg,
    hasAdminRole,
    hasMemberRole,
    isGlobalAdmin,
    userMemberships: userMemberships?.data?.map(m => ({ id: m.organization.id, name: m.organization.name }))
  });

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
          </div>

          <div className="flex items-center gap-2">
            {/* Command Bar */}
            <button
              onClick={() => setCommandPaletteOpen(true)}
              className="px-4 py-2 bg-white border-2 border-black hover:bg-black hover:text-white transition-all flex items-center gap-2 text-sm"
              aria-label="Open command palette"
            >
              <Search className="w-4 h-4" />
              <span className="font-mono text-xs uppercase">Search</span>
              <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-white text-black border border-black rounded font-mono">
                {typeof window !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}K
              </kbd>
            </button>

            <Button
              onClick={() => setCreateWorkflowOpen(true)}
              className="bg-black text-white hover:bg-gray-800 relative"
              title="Create new workflow (N)"
            >
              <Plus className="w-4 h-4 mr-2" />
              NEW WORKFLOW
              <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-white text-black rounded font-mono">N</kbd>
            </Button>
          </div>
        </div>

        {/* Workflows List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold font-mono uppercase">Available Workflows</h2>
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
                  onDelete={() => handleDeleteWorkflow(workflow.id)}
                  onToggleCron={() => handleToggleCron(workflow.id)}
                  onManageOrganizations={() => handleManageOrganizations(workflow.id)}
                  isMediarAdmin={!!isGlobalAdmin}
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
        {(executions.length > 0 || executionsLoading) && (
          <div className="space-y-4 mt-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold font-mono uppercase">
                  Recent Executions
                  {executionWorkflowFilter !== "all" && !executionsLoading && (
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
                disabled={executionsLoading}
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
                    <th className="text-left p-3 font-mono">Message</th>
                    <th className="text-left p-3 font-mono">Started</th>
                    <th className="text-left p-3 font-mono">Duration</th>
                    <th className="text-left p-3 font-mono">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {executionsLoading && filteredExecutions.length === 0 ? (
                    // Only show skeleton rows on initial load
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={`skeleton-${index}`} className="border-t border-gray-200">
                        <td className="p-3">
                          <Skeleton className="h-4 w-32" />
                        </td>
                        <td className="p-3">
                          <Skeleton className="h-6 w-20" />
                        </td>
                        <td className="p-3">
                          <Skeleton className="h-4 w-48" />
                        </td>
                        <td className="p-3">
                          <Skeleton className="h-4 w-40" />
                        </td>
                        <td className="p-3">
                          <Skeleton className="h-4 w-16" />
                        </td>
                        <td className="p-3">
                          <Skeleton className="h-8 w-8" />
                        </td>
                      </tr>
                    ))
                  ) : (
                    filteredExecutions.slice(0, 10).map(execution => {
                    const workflow = workflows.find(w => w.id === execution.workflow_id);
                    const isLive = liveExecutions.some(le => le.id === execution.execution_id);
                    const workflowResult = execution.results?.workflow_result;

                    // Determine badge based on priority: technical errors, skipped, business outcome
                    let badge, badgeColor;
                    if (execution.status === 'error' || execution.status === 'timeout') {
                      badge = execution.status.toUpperCase();
                      badgeColor = 'bg-black text-white font-bold';
                    } else if (execution.status === 'skipped' || workflowResult?.skipped) {
                      badge = 'SKIPPED';
                      badgeColor = 'bg-gray-200 text-gray-800';
                    } else if (workflowResult?.success) {
                      badge = 'COMPLETED';
                      badgeColor = 'bg-white border-2 border-black';
                    } else if (execution.status === 'failed' || workflowResult?.success === false) {
                      badge = 'FAILED';
                      badgeColor = 'bg-black text-white font-bold';
                    } else if (execution.status === 'running' || isLive) {
                      badge = 'RUNNING';
                      badgeColor = 'bg-black text-white animate-pulse';
                    } else if (execution.status === 'cancelled') {
                      badge = 'CANCELLED';
                      badgeColor = 'bg-gray-200 text-gray-800';
                    } else {
                      badge = execution.status.toUpperCase();
                      badgeColor = 'bg-gray-200 text-gray-800';
                    }

                    // Get message from workflow_result or error_message
                    // Treat "No message from parser" as missing and fall back to error_message
                    const message = (workflowResult?.message && workflowResult.message !== "No message from parser")
                      ? workflowResult.message
                      : execution.error_message || '-';
                    const truncatedMessage = message.length > 80 ? message.substring(0, 80) + '...' : message;

                    return (
                      <tr
                        key={`execution-${execution.execution_id}`}
                        className="border-t border-gray-200 hover:bg-gray-50 cursor-pointer"
                        onClick={() => fetchExecutionDetails(execution.execution_id)}
                      >
                        <td className="p-3 font-mono text-sm">
                          {workflow?.name || `Workflow ${execution.workflow_id}`}
                        </td>
                        <td className="p-3">
                          <span className={`font-mono text-xs px-2 py-1 ${badgeColor}`}>
                            {badge}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-xs text-gray-700">
                          {truncatedMessage}
                        </td>
                        <td className="p-3 font-mono text-sm">
                          {new Date(execution.started_at || execution.created_at).toLocaleString()}
                        </td>
                        <td className="p-3 font-mono text-sm">
                          {execution.completed_at && execution.started_at
                            ? `${Math.round((new Date(execution.completed_at).getTime() - new Date(execution.started_at).getTime()) / 1000)}s`
                            : isLive ? 'Running...' : '-'}
                        </td>
                        <td className="p-3">
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 border border-black hover:bg-black hover:text-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                fetchExecutionDetails(execution.execution_id);
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
                                disabled={stoppingExecutions.has(execution.execution_id)}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm(`Are you sure you want to ${execution.status === 'queued' ? 'cancel' : 'stop'} this execution?`)) {
                                    try {
                                      setStoppingExecutions(prev => new Set(prev).add(execution.execution_id));
                                      const response = await fetch(`/api/remote-workflows/executions/${execution.execution_id}/cancel`, {
                                        method: 'POST',
                                      });
                                      if (response.ok) {
                                        await fetchExecutions(false);
                                        await fetchLiveExecutions();
                                      } else {
                                        const error = await response.json();
                                        console.error('Cancel failed:', error);
                                        toast.error(`Failed to cancel execution: ${error.error || 'Unknown error'}`);
                                      }
                                    } catch (error) {
                                      console.error('Error canceling execution:', error);
                                      toast.error('Error canceling execution');
                                    } finally {
                                      setStoppingExecutions(prev => {
                                        const newSet = new Set(prev);
                                        newSet.delete(execution.execution_id);
                                        return newSet;
                                      });
                                    }
                                  }
                                }}
                                title={execution.status === 'queued' ? 'Cancel' : 'Stop'}
                              >
                                <StopCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 border border-black hover:bg-red-600 hover:text-white hover:border-red-600"
                                disabled={deletingExecutions.has(execution.execution_id)}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm(`Are you sure you want to DELETE this execution? This cannot be undone.`)) {
                                    try {
                                      setDeletingExecutions(prev => new Set(prev).add(execution.execution_id));
                                      const response = await fetch(`/api/remote-workflows/executions/${execution.execution_id}/delete`, {
                                        method: 'DELETE',
                                      });
                                      if (response.ok) {
                                        await fetchExecutions(false);
                                        await fetchLiveExecutions();
                                      } else {
                                        const error = await response.json();
                                        console.error('Delete failed:', error);
                                        toast.error(`Failed to delete execution: ${error.error || 'Unknown error'}`);
                                      }
                                    } catch (error) {
                                      console.error('Error deleting execution:', error);
                                      toast.error('Error deleting execution');
                                    } finally {
                                      setDeletingExecutions(prev => {
                                        const newSet = new Set(prev);
                                        newSet.delete(execution.execution_id);
                                        return newSet;
                                      });
                                    }
                                  }
                                }}
                                title="Delete Execution"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Command Palette */}
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          workflows={workflows}
          executions={executions}
          onExecuteWorkflow={handleQuickExecute}
          onDuplicateWorkflow={handleQuickDuplicate}
          onViewWorkflow={fetchWorkflowOverview}
          onViewExecution={execution => {
            fetchExecutionDetails(execution.execution_id);
          }}
          onCreateWorkflow={() => setCreateWorkflowOpen(true)}
          onRefresh={() => fetchWorkflows(true)}
        />

        {/* Dialogs */}
        <CreateWorkflowDialog
          open={createWorkflowOpen}
          onOpenChange={open => {
            setCreateWorkflowOpen(open);
            if (!open) {
              setTemplateYaml('');
              setTemplateName('');
            }
          }}
          initialYaml={templateYaml}
          initialName={templateName}
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

        {selectedWorkflowForAction && (
          <BatchTestDialog
            workflow={selectedWorkflowForAction}
            open={batchTestOpen}
            onOpenChange={setBatchTestOpen}
            onSubmit={() => {
              fetchExecutions(false);
            }}
          />
        )}

        {selectedWorkflowForOrgAssignment && (
          <OrganizationAssignmentDialog
            open={orgAssignmentOpen}
            onOpenChange={(open) => {
              setOrgAssignmentOpen(open);
              if (!open) {
                // Clean up when dialog closes
                setSelectedWorkflowForOrgAssignment(null);
              }
            }}
            workflowId={selectedWorkflowForOrgAssignment.id}
            workflowName={selectedWorkflowForOrgAssignment.name}
            onSuccess={() => {
              // Only refresh workflows after successful save
              setTimeout(() => {
                fetchWorkflows(false);
              }, 100);
            }}
          />
        )}
      </div>
    </DashboardLayout>
  );
}