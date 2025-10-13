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
import { useEffect, useState, useCallback, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { toast } from 'sonner';

function DashboardContent() {
  const { organization, isLoaded: _orgLoaded } = useOrganization();
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
  const workflowsRef = useRef<WorkflowWithSettings[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [_pollCount, setPollCount] = useState(0);

  // Filter values state (available options from DB)
  const [filterWorkflowNames, setFilterWorkflowNames] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterMachines, setFilterMachines] = useState<string[]>([]);

  // Active filter state (currently selected filters) - Load from localStorage
  const [activeWorkflowFilter, setActiveWorkflowFilter] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-workflow') || undefined;
    }
    return undefined;
  });
  const [activeStatusFilter, setActiveStatusFilter] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-status') || undefined;
    }
    return undefined;
  });
  const [activeMachineFilter, setActiveMachineFilter] = useState<string | undefined>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-machine') || undefined;
    }
    return undefined;
  });
  const [activeSearchFilter, setActiveSearchFilter] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-search') || '';
    }
    return '';
  });
  const [activeSearchField, setActiveSearchField] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-search-field') || 'all';
    }
    return 'all';
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('executions-page-size');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
    return 100; // Default page size
  });
  const [totalExecutions, setTotalExecutions] = useState(0);

  // Refs to capture latest filter values without causing re-renders
  const activeWorkflowFilterRef = useRef<string | undefined>(undefined);
  const activeStatusFilterRef = useRef<string | undefined>(undefined);
  const activeMachineFilterRef = useRef<string | undefined>(undefined);
  const activeSearchFilterRef = useRef<string>('');
  const activeSearchFieldRef = useRef<string>('all');
  const currentPageRef = useRef<number>(1);
  const pageSizeRef = useRef<number>(100);

  // Keep refs in sync with state
  useEffect(() => {
    activeWorkflowFilterRef.current = activeWorkflowFilter;
  }, [activeWorkflowFilter]);

  useEffect(() => {
    activeStatusFilterRef.current = activeStatusFilter;
  }, [activeStatusFilter]);

  useEffect(() => {
    activeMachineFilterRef.current = activeMachineFilter;
  }, [activeMachineFilter]);

  useEffect(() => {
    activeSearchFilterRef.current = activeSearchFilter;
  }, [activeSearchFilter]);

  useEffect(() => {
    activeSearchFieldRef.current = activeSearchField;
  }, [activeSearchField]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

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
  const [uploadVersionOpen, setUploadVersionOpen] = useState(false);
  const [selectedWorkflowForVersion, setSelectedWorkflowForVersion] = useState<WorkflowWithSettings | null>(null);

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
        workflowsRef.current = sortedWorkflows;

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

  const fetchExecutions = useCallback(async (
    showLoading = true,
    filterWorkflow?: string,
    filterStatus?: string,
    filterMachine?: string,
    searchQuery?: string,
    searchField?: string,
    page?: number,
    pageSizeParam?: number
  ) => {
    try {
      if (showLoading) setExecutionsLoading(true);

      // Build query params
      const params = new URLSearchParams();

      // Pagination
      const effectivePageSize = pageSizeParam || pageSize;
      const effectivePage = page || currentPage;
      const offset = (effectivePage - 1) * effectivePageSize;
      params.set('limit', effectivePageSize.toString());
      params.set('offset', offset.toString());

      if (viewOrgId) params.set('viewOrgId', viewOrgId);

      // Apply filters to API query
      if (filterWorkflow) {
        // Find workflow ID from name - use ref to avoid dependency
        const workflow = workflowsRef.current.find(w => w.name === filterWorkflow);
        if (workflow) {
          params.set('workflow_id', workflow.id.toString());
        }
      }
      if (filterStatus) {
        params.set('status', filterStatus);
      }
      if (filterMachine) {
        params.set('machine', filterMachine);
      }
      if (searchQuery) {
        params.set('search', searchQuery);
        if (searchField) {
          params.set('search_field', searchField);
        }
      }

      const apiUrl = `/api/remote-workflows/executions?${params.toString()}`;
      const response = await fetch(apiUrl);
      const executionsData = await response.json();
      if (executionsData.success) {
        // Always update with fresh data from API to ensure UI stays in sync
        setExecutions(executionsData.executions || []);
        // Update total count for pagination
        setTotalExecutions(executionsData.pagination?.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
      setExecutions([]);
      setTotalExecutions(0);
    } finally {
      if (showLoading) setExecutionsLoading(false);
    }
  }, [viewOrgId, pageSize, currentPage]);

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

  const fetchExecutionFilters = useCallback(async () => {
    try {
      const apiUrl = viewOrgId
        ? `/api/remote-workflows/executions/filters?viewOrgId=${viewOrgId}`
        : '/api/remote-workflows/executions/filters';
      const response = await fetch(apiUrl);
      if (!response.ok) {
        console.error('[Dashboard] Failed to fetch filters:', response.status);
        return;
      }
      const data = await response.json();
      if (data.success && data.filters) {
        setFilterWorkflowNames(data.filters.workflowNames || []);
        setFilterStatuses(data.filters.statuses || []);
        setFilterMachines(data.filters.machines || []);
      }
    } catch (error) {
      console.error('Failed to fetch execution filters:', error);
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
      // Fetch only basic info first - heavy fields will be loaded on demand
      const response = await fetch(`/api/remote-workflows/executions/${executionId}`);
      const executionData = await response.json();
      if (executionData.success) {
        setSelectedExecution(executionData.execution);
      }
    } catch (error) {
      console.error('Failed to fetch execution details:', error);
      setExecutionDetailsOpen(false);
    }
  }, []);

  const handleCancelExecution = useCallback(async (executionId: number) => {
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
        toast.error(`Failed to cancel execution: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error canceling execution:', error);
      toast.error('Error canceling execution');
    }
  }, [fetchExecutions, fetchLiveExecutions]);

  const handleDeleteExecution = useCallback(async (executionId: number) => {
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
        toast.error(`Failed to delete execution: ${error.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error deleting execution:', error);
      toast.error('Error deleting execution');
    }
  }, [fetchExecutions, fetchLiveExecutions]);

  const handleRefreshExecutions = useCallback(() => {
    fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, currentPage, pageSize);
  }, [fetchExecutions, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, currentPage, pageSize]);

  // Handle filter changes - refetch from API and save to localStorage
  const handleWorkflowFilterChange = useCallback((workflowName: string | undefined) => {
    setActiveWorkflowFilter(workflowName);
    setCurrentPage(1); // Reset to first page on filter change
    if (typeof window !== 'undefined') {
      if (workflowName) {
        localStorage.setItem('executions-filter-workflow', workflowName);
      } else {
        localStorage.removeItem('executions-filter-workflow');
      }
    }
    fetchExecutions(true, workflowName, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, 1, pageSize);
  }, [fetchExecutions, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, pageSize]);

  const handleStatusFilterChange = useCallback((status: string | undefined) => {
    setActiveStatusFilter(status);
    setCurrentPage(1); // Reset to first page on filter change
    if (typeof window !== 'undefined') {
      if (status) {
        localStorage.setItem('executions-filter-status', status);
      } else {
        localStorage.removeItem('executions-filter-status');
      }
    }
    fetchExecutions(true, activeWorkflowFilter, status, activeMachineFilter, activeSearchFilter, activeSearchField, 1, pageSize);
  }, [fetchExecutions, activeWorkflowFilter, activeMachineFilter, activeSearchFilter, activeSearchField, pageSize]);

  const handleMachineFilterChange = useCallback((machine: string | undefined) => {
    setActiveMachineFilter(machine);
    setCurrentPage(1); // Reset to first page on filter change
    if (typeof window !== 'undefined') {
      if (machine) {
        localStorage.setItem('executions-filter-machine', machine);
      } else {
        localStorage.removeItem('executions-filter-machine');
      }
    }
    fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, machine, activeSearchFilter, activeSearchField, 1, pageSize);
  }, [fetchExecutions, activeWorkflowFilter, activeStatusFilter, activeSearchFilter, activeSearchField, pageSize]);

  const handleSearchFilterChange = useCallback((search: string) => {
    setActiveSearchFilter(search);
    setCurrentPage(1); // Reset to first page on search change
    if (typeof window !== 'undefined') {
      if (search) {
        localStorage.setItem('executions-filter-search', search);
      } else {
        localStorage.removeItem('executions-filter-search');
      }
    }
    fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, search, activeSearchField, 1, pageSize);
  }, [fetchExecutions, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchField, pageSize]);

  const handleSearchFieldChange = useCallback((searchField: string) => {
    setActiveSearchField(searchField);
    if (typeof window !== 'undefined') {
      localStorage.setItem('executions-filter-search-field', searchField);
    }
    // If there's an active search, refetch with new field
    if (activeSearchFilter) {
      fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, searchField, currentPage, pageSize);
    }
  }, [fetchExecutions, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, currentPage, pageSize]);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
    fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, newPage, pageSize);
  }, [fetchExecutions, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, pageSize]);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
    if (typeof window !== 'undefined') {
      localStorage.setItem('executions-page-size', newPageSize.toString());
    }
    fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, 1, newPageSize);
  }, [fetchExecutions, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField]);

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

  const handleUploadVersion = useCallback((workflowId: number) => {
    const workflow = workflows.find(w => w.id === workflowId);
    if (!workflow) return;

    setSelectedWorkflowForVersion(workflow);
    setUploadVersionOpen(true);
  }, [workflows]);

  // Initial data loading and refetch when viewOrgId changes
  useEffect(() => {
    fetchWorkflows();
    // Pass saved filters to initial fetch
    fetchExecutions(true, activeWorkflowFilter, activeStatusFilter, activeMachineFilter, activeSearchFilter, activeSearchField, currentPage, pageSize);
    fetchLiveExecutions();
    fetchExecutionFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWorkflows, fetchLiveExecutions, fetchExecutionFilters, viewOrgId]);

  // Polling for executions - always poll to catch new executions
  useEffect(() => {
    let localPollCount = 0;
    // Always poll for executions
    const pollTimer = setInterval(() => {
      localPollCount++;
      setPollCount(localPollCount);

      // Always fetch live executions
      fetchLiveExecutions();

      // Fetch all executions every 5 seconds (every 2nd poll)
      // This ensures new executions appear within 5 seconds
      // Use refs to get current filter values without causing re-renders
      if (localPollCount % 2 === 0) {
        fetchExecutions(
          false,
          activeWorkflowFilterRef.current,
          activeStatusFilterRef.current,
          activeMachineFilterRef.current,
          activeSearchFilterRef.current,
          activeSearchFieldRef.current,
          currentPageRef.current,
          pageSizeRef.current
        );
      }
    }, 2500); // Poll every 2.5 seconds

    return () => clearInterval(pollTimer);
  }, [fetchLiveExecutions, fetchExecutions]); // Only depends on fetch functions, not filter values

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

  const _isMediarOrg = organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isGlobalAdmin = hasMediarEmail || isMemberOfMediarOrg;
  const canDelete = isGlobalAdmin;

  return (
    <DashboardLayout>
      <div className="p-4">
        {/* Header */}
        <div className="max-w-7xl mx-auto">
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
              {/* Stats Bar - Inline */}
              <div className="border-2 border-black p-2 mb-4 flex items-center gap-6">
              {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} className="flex items-center gap-2">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-sm font-medium text-gray-600 uppercase">{stat.label}</span>
                      <span className="font-mono text-lg font-bold">{stat.value}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Header with Actions */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold font-mono uppercase">Available Workflows</h2>
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
            <div className="mb-4">
              {workflows.length > 0 ? (
                <div className="border-2 border-black divide-y divide-gray-200">
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
                      onUploadVersion={() => handleUploadVersion(workflow.id)}
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
              <div className="space-y-3 mt-4">
                <h2 className="text-sm font-bold font-mono uppercase">Recent Executions</h2>

                <ExecutionsDataTable
                  executions={executions}
                  workflows={workflows}
                  liveExecutions={liveExecutions}
                  loading={executionsLoading}
                  canDelete={canDelete}
                  onViewDetails={fetchExecutionDetails}
                  onCancelExecution={handleCancelExecution}
                  onDeleteExecution={handleDeleteExecution}
                  onRefresh={handleRefreshExecutions}
                  filterWorkflowNames={filterWorkflowNames}
                  filterStatuses={filterStatuses}
                  filterMachines={filterMachines}
                  onWorkflowFilterChange={handleWorkflowFilterChange}
                  onStatusFilterChange={handleStatusFilterChange}
                  onMachineFilterChange={handleMachineFilterChange}
                  onSearchFilterChange={handleSearchFilterChange}
                  onSearchFieldChange={handleSearchFieldChange}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  activeWorkflowFilter={activeWorkflowFilter}
                  activeStatusFilter={activeStatusFilter}
                  activeMachineFilter={activeMachineFilter}
                  activeSearchFilter={activeSearchFilter}
                  activeSearchField={activeSearchField}
                  currentPage={currentPage}
                  pageSize={pageSize}
                  totalRecords={totalExecutions}
                />
              </div>
            )}
          </>
        )}
        </div>

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
              // Immediately fetch new executions after submission
              setTimeout(() => {
                fetchExecutions(false);
                fetchLiveExecutions();
              }, 500); // Small delay to ensure DB write completes
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

        {selectedWorkflowForVersion && (
          <CreateWorkflowDialog
            open={uploadVersionOpen}
            onOpenChange={(open) => {
              setUploadVersionOpen(open);
              if (!open) {
                setSelectedWorkflowForVersion(null);
              }
            }}
            mode="update"
            workflowId={selectedWorkflowForVersion.id}
            workflowName={selectedWorkflowForVersion.name}
            onWorkflowCreated={() => {
              setUploadVersionOpen(false);
              fetchWorkflows(false);
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
