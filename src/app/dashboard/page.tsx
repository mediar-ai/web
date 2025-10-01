'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { PageHeader } from '@/components/layouts/PageHeader';
import { CreateWorkflowDialog } from '@/components/deployments/CreateWorkflowDialogImproved';
import { ExecutionDetailsDialog } from '@/components/deployments/ExecutionDetailsDialog';
import { WorkflowCardEnhanced } from '@/components/deployments/WorkflowCardEnhanced';
import { UnifiedWorkflowDialog } from '@/components/deployments/UnifiedWorkflowDialog';
import { CommandPalette } from '@/components/deployments/CommandPalette';
import { useKeyboardNavigation } from '@/hooks/useKeyboardNavigation';
import { WorkflowActionsDialog } from '@/components/deployments/WorkflowActionsDialog';
import { BatchTestDialog } from '@/components/deployments/BatchTestDialog';
import { OrganizationAssignmentDialog } from '@/components/deployments/OrganizationAssignmentDialog';
import { ExecutionsDataTable } from '@/components/dashboard/ExecutionsDataTable';
import { Button } from '@/components/ui/button';
import { useOrganization, useOrganizationList, useUser } from '@clerk/nextjs';
import { Activity, Workflow, TrendingUp, Zap, Plus, Search } from 'lucide-react';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

function DashboardContent() {
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { user } = useUser();
  const { userMemberships } = useOrganizationList();
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');

  // Stats state
  const [stats, setStats] = useState([
    { label: 'Active Workflows', value: '0', icon: Workflow, change: '' },
    { label: 'Total Executions', value: '0', icon: Activity, change: '' },
    { label: 'Avg Speed', value: '0s', icon: Zap, change: '' },
    { label: 'Success Rate', value: '0%', icon: TrendingUp, change: '' },
  ]);

  // Workflows and executions state
  const [workflows, setWorkflows] = useState<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  // UI state
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowOverview | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  const [actionsDialogMode, setActionsDialogMode] = useState<'rename' | 'duplicate' | null>(null);
  const [batchTestOpen, setBatchTestOpen] = useState(false);
  const [selectedWorkflowForAction, setSelectedWorkflowForAction] = useState<WorkflowWithSettings | null>(null);
  const [templateYaml, setTemplateYaml] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [orgAssignmentOpen, setOrgAssignmentOpen] = useState(false);
  const [selectedWorkflowForOrgAssignment, setSelectedWorkflowForOrgAssignment] = useState<WorkflowWithSettings | null>(null);

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

        // Update stats
        const activeWorkflows = sortedWorkflows.filter((w: any) => w.status === 'active').length;
        let totalExecutions = 0;
        let successfulExecutions = 0;
        let totalDuration = 0;
        let durationCount = 0;

        sortedWorkflows.forEach((w: any) => {
          totalExecutions += w.total_executions || 0;
          successfulExecutions += w.successful_runs || 0;
          if (w.current_version_stats?.average_duration_seconds) {
            totalDuration += w.current_version_stats.average_duration_seconds;
            durationCount++;
          }
        });

        const successRate = totalExecutions > 0
          ? Math.round((successfulExecutions / totalExecutions) * 100)
          : 0;

        const avgDuration = durationCount > 0
          ? Math.round(totalDuration / durationCount)
          : 0;

        setStats([
          { label: 'Active Workflows', value: activeWorkflows.toString(), icon: Workflow, change: '' },
          { label: 'Total Executions', value: totalExecutions.toString(), icon: Activity, change: '' },
          { label: 'Avg Speed', value: `${avgDuration}s`, icon: Zap, change: '' },
          { label: 'Success Rate', value: `${successRate}%`, icon: TrendingUp, change: '' },
        ]);
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
      const apiUrl = viewOrgId
        ? `/api/remote-workflows/executions?limit=50&viewOrgId=${viewOrgId}`
        : '/api/remote-workflows/executions?limit=50';
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

  const handleQuickEdit = useCallback((workflowId: number) => {
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
    console.log('[Dashboard] viewOrgId changed to:', viewOrgId);
    fetchWorkflows();
    fetchExecutions();
    fetchLiveExecutions();
  }, [fetchWorkflows, fetchExecutions, fetchLiveExecutions, viewOrgId]);

  // Polling for live executions (30 seconds, only when active)
  useEffect(() => {
    if (liveExecutions.length === 0) return; // Don't poll if nothing active

    const pollTimer = setInterval(() => {
      setPollCount(prev => prev + 1);
      fetchLiveExecutions();
      // Only fetch all executions every 5th poll
      if (pollCount % 5 === 0) fetchExecutions(false);
    }, 30000);

    return () => clearInterval(pollTimer);
  }, [liveExecutions.length, fetchLiveExecutions, fetchExecutions, pollCount]);

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

  // Check if user has admin privileges
  const hasMediarEmail = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;

  const isMemberOfMediarOrg = userMemberships?.data?.some(
    membership => MEDIAR_ORG_IDS.includes(membership.organization.id)
  ) || false;

  const isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isGlobalAdmin = hasMediarEmail || isMemberOfMediarOrg;
  const canDelete = isGlobalAdmin;

  return (
    <DashboardLayout>
      <div className="p-8">
        {/* Header */}
        <PageHeader
          title="Dashboard"
          subtitle={`Welcome back to ${organization?.name || 'your workspace'}`}
        />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto mb-4"></div>
              <p className="text-gray-600 font-mono">Loading dashboard...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="border-2 border-black p-4">
                    <div className="flex items-start justify-between mb-2">
                      <Icon className="w-5 h-5" />
                      <span className="font-mono text-xs text-gray-600">{stat.change}</span>
                    </div>
                    <p className="font-mono text-2xl font-bold mb-1">{stat.value}</p>
                    <p className="font-mono text-xs text-gray-600">{stat.label}</p>
                  </div>
                );
              })}
            </div>

            {/* Header with Actions */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold font-mono uppercase">Available Workflows</h2>
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
            <div className="space-y-4 mb-8">
              {workflows.length > 0 ? (
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
                <h2 className="text-lg font-bold font-mono uppercase">Recent Executions</h2>

                <ExecutionsDataTable
                  executions={executions}
                  workflows={workflows}
                  liveExecutions={liveExecutions}
                  loading={executionsLoading}
                  canDelete={canDelete}
                  onViewDetails={fetchExecutionDetails}
                  onCancelExecution={async (executionId) => {
                    try {
                      const response = await fetch(`/api/remote-workflows/executions/${executionId}/cancel`, {
                        method: 'POST',
                      });
                      if (response.ok) {
                        await fetchExecutions(false);
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
                  }}
                  onDeleteExecution={async (executionId) => {
                    try {
                      const response = await fetch(`/api/remote-workflows/executions/${executionId}/delete`, {
                        method: 'DELETE',
                      });
                      if (response.ok) {
                        await fetchExecutions(false);
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
                  }}
                  onRefresh={() => fetchExecutions(true)}
                />
              </div>
            )}
          </>
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
                setSelectedWorkflowForOrgAssignment(null);
              }
            }}
            workflowId={selectedWorkflowForOrgAssignment.id}
            workflowName={selectedWorkflowForOrgAssignment.name}
            onSuccess={() => {
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

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto"></div>
        </div>
      </DashboardLayout>
    }>
      <DashboardContent />
    </Suspense>
  );
}
