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
import {
  useOrganization,
  useOrganizationList,
  useUser,
  useAuth,
} from '@clerk/nextjs';
import {
  Activity,
  Workflow,
  TrendingUp,
  Zap,
  Search,
  Eye,
  EyeOff,
  Wand2,
  Tag,
  X,
  Monitor,
} from 'lucide-react';
import {
  useEffect,
  useState,
  useCallback,
  Suspense,
  useRef,
  useMemo,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { usePostHog } from 'posthog-js/react';
import {
  Execution,
  LiveExecutionStatus,
  WorkflowOverview,
  WorkflowWithSettings,
} from '@/lib/workflow-types';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { LaunchVmDialog, CreditsDisplay } from '@/components/vm';

function DashboardContent() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const { organization, isLoaded: _orgLoaded } = useOrganization();
  const { user } = useUser();
  const { userMemberships } = useOrganizationList();
  const searchParams = useSearchParams();
  const viewOrgId = searchParams.get('viewOrgId');
  const posthog = usePostHog();

  // Redirect unauthenticated users to sign-in
  useEffect(() => {
    if (isLoaded && !userId) {
      router.push('/');
    }
  }, [isLoaded, userId, router]);

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
  const [liveExecutions, setLiveExecutions] = useState<LiveExecutionStatus[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [initialExecutionsFetchDone, setInitialExecutionsFetchDone] =
    useState(false);
  const [_pollCount, setPollCount] = useState(0);

  // Filter values state (available options from DB)
  const [filterWorkflowNames, setFilterWorkflowNames] = useState<string[]>([]);
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterMachines, setFilterMachines] = useState<string[]>([]);

  // Active filter state (currently selected filters) - Load from localStorage
  const [activeWorkflowFilter, setActiveWorkflowFilter] = useState<
    string | undefined
  >(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-workflow') || undefined;
    }
    return undefined;
  });
  const [activeStatusFilter, setActiveStatusFilter] = useState<
    string | undefined
  >(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('executions-filter-status') || undefined;
    }
    return undefined;
  });
  const [activeMachineFilter, setActiveMachineFilter] = useState<
    string | undefined
  >(() => {
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

  // Show/hide queued executions toggle (persisted in localStorage)
  const [showQueuedExecutions, setShowQueuedExecutions] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showQueuedExecutions');
      return saved !== null ? JSON.parse(saved) : false; // Default: hide queued
    }
    return false;
  });

  // Show/hide skipped executions toggle (persisted in localStorage)
  const [showSkippedExecutions, setShowSkippedExecutions] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showSkippedExecutions');
      return saved !== null ? JSON.parse(saved) : false; // Default: hide skipped
    }
    return false;
  });
  const [activeSearchMode, setActiveSearchMode] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const savedField =
        localStorage.getItem('executions-filter-search-field') || 'all';
      // Default to 'exact' for execution_id, 'contains' for others
      if (savedField === 'execution_id') {
        return localStorage.getItem('executions-filter-search-mode') || 'exact';
      }
      return (
        localStorage.getItem('executions-filter-search-mode') || 'contains'
      );
    }
    return 'contains';
  });

  // Workflow tag filter state (for filtering workflow cards)
  // Don't persist across orgs - start fresh each session
  const [selectedWorkflowTags, setSelectedWorkflowTags] = useState<string[]>(
    []
  );

  // Reset tag filter when org changes
  useEffect(() => {
    setSelectedWorkflowTags([]);
  }, [organization?.id, viewOrgId]);

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
  // Initialize refs with localStorage values so polling uses correct filters from the start
  const activeWorkflowFilterRef = useRef<string | undefined>(
    typeof window !== 'undefined'
      ? localStorage.getItem('executions-filter-workflow') || undefined
      : undefined
  );
  const activeStatusFilterRef = useRef<string | undefined>(
    typeof window !== 'undefined'
      ? localStorage.getItem('executions-filter-status') || undefined
      : undefined
  );
  const activeMachineFilterRef = useRef<string | undefined>(
    typeof window !== 'undefined'
      ? localStorage.getItem('executions-filter-machine') || undefined
      : undefined
  );
  const activeSearchFilterRef = useRef<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('executions-filter-search') || ''
      : ''
  );
  const activeSearchFieldRef = useRef<string>(
    typeof window !== 'undefined'
      ? localStorage.getItem('executions-filter-search-field') || 'all'
      : 'all'
  );
  const activeSearchModeRef = useRef<string>(
    (() => {
      if (typeof window !== 'undefined') {
        const savedField =
          localStorage.getItem('executions-filter-search-field') || 'all';
        if (savedField === 'execution_id') {
          return (
            localStorage.getItem('executions-filter-search-mode') || 'exact'
          );
        }
        return (
          localStorage.getItem('executions-filter-search-mode') || 'contains'
        );
      }
      return 'contains';
    })()
  );
  const currentPageRef = useRef<number>(1);
  const pageSizeRef = useRef<number>(
    (() => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('executions-page-size');
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed) && parsed > 0) {
            return parsed;
          }
        }
      }
      return 100;
    })()
  );

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
    activeSearchModeRef.current = activeSearchMode;
  }, [activeSearchMode]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  // UI state
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [createWorkflowOpen, setCreateWorkflowOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowOverview | null>(null);
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(
    null
  );
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);
  const [actionsDialogMode, setActionsDialogMode] = useState<
    'rename' | 'duplicate' | null
  >(null);
  const [batchTestOpen, setBatchTestOpen] = useState(false);
  const [selectedWorkflowForAction, setSelectedWorkflowForAction] =
    useState<WorkflowWithSettings | null>(null);
  const [templateYaml, setTemplateYaml] = useState<string>('');
  const [templateName, setTemplateName] = useState<string>('');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [orgAssignmentOpen, setOrgAssignmentOpen] = useState(false);
  const [
    selectedWorkflowForOrgAssignment,
    setSelectedWorkflowForOrgAssignment,
  ] = useState<WorkflowWithSettings | null>(null);
  const [uploadVersionOpen, setUploadVersionOpen] = useState(false);
  const [selectedWorkflowForVersion, setSelectedWorkflowForVersion] =
    useState<WorkflowWithSettings | null>(null);

  // VM Launch state
  const [launchVmOpen, setLaunchVmOpen] = useState(false);
  const [userCredits, setUserCredits] = useState(0);

  // Fetch user credits
  const fetchUserCredits = useCallback(async () => {
    try {
      const response = await fetch('/api/user/credits');
      const data = await response.json();
      setUserCredits(data.balance || 0);
    } catch {
      // Silently fail - credits feature may not be available
    }
  }, []);

  // Fetch credits on mount
  useEffect(() => {
    if (userId) {
      fetchUserCredits();
    }
  }, [userId, fetchUserCredits]);

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

  // Compute unique tags from all workflows
  const allWorkflowTags = useMemo(() => {
    const tagSet = new Set<string>();
    workflows.forEach(w => {
      if (w.tags && Array.isArray(w.tags)) {
        w.tags.forEach(tag => tagSet.add(tag));
      }
    });
    const tags = Array.from(tagSet).sort();
    console.log(
      '[Dashboard] allWorkflowTags:',
      tags,
      'from',
      workflows.length,
      'workflows'
    );
    console.log(
      '[Dashboard] Workflows with tags:',
      workflows
        .filter(w => w.tags && w.tags.length > 0)
        .map(w => ({ id: w.id, name: w.name, tags: w.tags }))
    );
    return tags;
  }, [workflows]);

  // Filter workflows by selected tags
  const filteredWorkflows = useMemo(() => {
    if (selectedWorkflowTags.length === 0) return workflows;
    return workflows.filter(w => {
      if (!w.tags || !Array.isArray(w.tags)) return false;
      return selectedWorkflowTags.every(tag => w.tags!.includes(tag));
    });
  }, [workflows, selectedWorkflowTags]);

  // Toggle tag filter (no localStorage - session only)
  const toggleTagFilter = (tag: string) => {
    setSelectedWorkflowTags(prev => {
      return prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag];
    });
  };

  // Keyboard shortcut for new workflow (N key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        const target = e.target as HTMLElement;
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        setCreateWorkflowOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch functions
  const fetchWorkflows = useCallback(
    async (showLoading = true) => {
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
          const activeWorkflows = sortedWorkflows.filter(
            (w: any) => w.status === 'active'
          ).length;
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

          const successRate =
            totalExecutions > 0
              ? Math.round((successfulExecutions / totalExecutions) * 100)
              : 0;

          const avgDuration =
            durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;

          setStats([
            {
              label: 'Active Workflows',
              value: activeWorkflows.toString(),
              icon: Workflow,
              change: '',
            },
            {
              label: 'Total Executions',
              value: totalExecutions.toString(),
              icon: Activity,
              change: '',
            },
            {
              label: 'Avg Speed',
              value: `${avgDuration}s`,
              icon: Zap,
              change: '',
            },
            {
              label: 'Success Rate',
              value: `${successRate}%`,
              icon: TrendingUp,
              change: '',
            },
          ]);
        }
      } catch (error) {
        console.error('Failed to fetch workflows:', error);
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [viewOrgId]
  );

  const fetchExecutions = useCallback(
    async (
      showLoading = true,
      filterWorkflow?: string,
      filterStatus?: string,
      filterMachine?: string,
      searchQuery?: string,
      searchField?: string,
      searchMode?: string,
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
          const workflow = workflowsRef.current.find(
            w => w.name === filterWorkflow
          );
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
          if (searchMode) {
            params.set('search_mode', searchMode);
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
          // Mark initial fetch as complete
          setInitialExecutionsFetchDone(true);
        }
      } catch (error) {
        console.error('Failed to fetch executions:', error);
        setExecutions([]);
        setTotalExecutions(0);
        setInitialExecutionsFetchDone(true);
      } finally {
        if (showLoading) setExecutionsLoading(false);
      }
    },
    [viewOrgId, pageSize, currentPage]
  );

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

  const fetchWorkflowOverview = useCallback(
    async (workflowId: number) => {
      try {
        posthog?.capture('dashboard_view_workflow_details', {
          workflow_id: workflowId,
          timestamp: new Date().toISOString(),
        });

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
      }
    },
    [posthog]
  );

  const fetchExecutionDetails = useCallback(
    async (executionId: number) => {
      try {
        posthog?.capture('dashboard_view_execution_details', {
          execution_id: executionId,
          timestamp: new Date().toISOString(),
        });

        setSelectedExecution(null);
        setExecutionDetailsOpen(true);
        // Fetch only basic info first - heavy fields will be loaded on demand
        const response = await fetch(
          `/api/remote-workflows/executions/${executionId}`
        );
        const executionData = await response.json();
        if (executionData.success) {
          setSelectedExecution(executionData.execution);
        }
      } catch (error) {
        console.error('Failed to fetch execution details:', error);
        setExecutionDetailsOpen(false);
      }
    },
    [posthog]
  );

  const handleCancelExecution = useCallback(
    async (executionId: number) => {
      try {
        posthog?.capture('dashboard_cancel_execution', {
          execution_id: executionId,
          timestamp: new Date().toISOString(),
        });

        const response = await fetch(
          `/api/remote-workflows/executions/${executionId}/cancel`,
          {
            method: 'POST',
          }
        );
        if (response.ok) {
          await fetchExecutions(false);
          await fetchLiveExecutions();
        } else {
          const error = await response.json();
          console.error('Cancel failed:', error);
          toast.error(
            `Failed to cancel execution: ${error.error || 'Unknown error'}`
          );
        }
      } catch (error) {
        console.error('Error canceling execution:', error);
        toast.error('Error canceling execution');
      }
    },
    [fetchExecutions, fetchLiveExecutions, posthog]
  );

  const handleDeleteExecution = useCallback(
    async (executionId: number) => {
      try {
        posthog?.capture('dashboard_delete_execution', {
          execution_id: executionId,
          timestamp: new Date().toISOString(),
        });

        const response = await fetch(
          `/api/remote-workflows/executions/${executionId}/delete`,
          {
            method: 'DELETE',
          }
        );
        if (response.ok) {
          await fetchExecutions(false);
          await fetchLiveExecutions();
        } else {
          const error = await response.json();
          console.error('Delete failed:', error);
          toast.error(
            `Failed to delete execution: ${error.error || 'Unknown error'}`
          );
        }
      } catch (error) {
        console.error('Error deleting execution:', error);
        toast.error('Error deleting execution');
      }
    },
    [fetchExecutions, fetchLiveExecutions, posthog]
  );

  const handleRefreshExecutions = useCallback(() => {
    fetchExecutions(
      true,
      activeWorkflowFilter,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchField,
      activeSearchMode,
      currentPage,
      pageSize
    );
  }, [
    fetchExecutions,
    activeWorkflowFilter,
    activeStatusFilter,
    activeMachineFilter,
    activeSearchFilter,
    activeSearchField,
    activeSearchMode,
    currentPage,
    pageSize,
  ]);

  // Handle filter changes - refetch from API and save to localStorage
  const handleWorkflowFilterChange = useCallback(
    (workflowName: string | undefined) => {
      posthog?.capture('dashboard_filter_workflow', {
        workflow_name: workflowName,
        timestamp: new Date().toISOString(),
      });

      setActiveWorkflowFilter(workflowName);
      setCurrentPage(1); // Reset to first page on filter change
      if (typeof window !== 'undefined') {
        if (workflowName) {
          localStorage.setItem('executions-filter-workflow', workflowName);
        } else {
          localStorage.removeItem('executions-filter-workflow');
        }
      }
      fetchExecutions(
        true,
        workflowName,
        activeStatusFilter,
        activeMachineFilter,
        activeSearchFilter,
        activeSearchField,
        activeSearchMode,
        1,
        pageSize
      );
    },
    [
      fetchExecutions,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchField,
      activeSearchMode,
      pageSize,
      posthog,
    ]
  );

  const handleStatusFilterChange = useCallback(
    (status: string | undefined) => {
      posthog?.capture('dashboard_filter_status', {
        status,
        timestamp: new Date().toISOString(),
      });

      setActiveStatusFilter(status);
      setCurrentPage(1); // Reset to first page on filter change
      if (typeof window !== 'undefined') {
        if (status) {
          localStorage.setItem('executions-filter-status', status);
        } else {
          localStorage.removeItem('executions-filter-status');
        }
      }
      fetchExecutions(
        true,
        activeWorkflowFilter,
        status,
        activeMachineFilter,
        activeSearchFilter,
        activeSearchField,
        activeSearchMode,
        1,
        pageSize
      );
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchField,
      activeSearchMode,
      pageSize,
      posthog,
    ]
  );

  const handleMachineFilterChange = useCallback(
    (machine: string | undefined) => {
      posthog?.capture('dashboard_filter_machine', {
        machine,
        timestamp: new Date().toISOString(),
      });

      setActiveMachineFilter(machine);
      setCurrentPage(1); // Reset to first page on filter change
      if (typeof window !== 'undefined') {
        if (machine) {
          localStorage.setItem('executions-filter-machine', machine);
        } else {
          localStorage.removeItem('executions-filter-machine');
        }
      }
      fetchExecutions(
        true,
        activeWorkflowFilter,
        activeStatusFilter,
        machine,
        activeSearchFilter,
        activeSearchField,
        activeSearchMode,
        1,
        pageSize
      );
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeStatusFilter,
      activeSearchFilter,
      activeSearchField,
      activeSearchMode,
      pageSize,
      posthog,
    ]
  );

  const handleSearchFilterChange = useCallback(
    (search: string) => {
      posthog?.capture('dashboard_search_executions', {
        search_query: search,
        search_field: activeSearchField,
        search_mode: activeSearchMode,
        timestamp: new Date().toISOString(),
      });

      setActiveSearchFilter(search);
      setCurrentPage(1); // Reset to first page on search change
      if (typeof window !== 'undefined') {
        if (search) {
          localStorage.setItem('executions-filter-search', search);
        } else {
          localStorage.removeItem('executions-filter-search');
        }
      }
      fetchExecutions(
        true,
        activeWorkflowFilter,
        activeStatusFilter,
        activeMachineFilter,
        search,
        activeSearchField,
        activeSearchMode,
        1,
        pageSize
      );
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchField,
      activeSearchMode,
      pageSize,
      posthog,
    ]
  );

  const handleSearchFieldChange = useCallback(
    (searchField: string) => {
      setActiveSearchField(searchField);
      if (typeof window !== 'undefined') {
        localStorage.setItem('executions-filter-search-field', searchField);
      }

      // Auto-switch search mode: exact for execution_id, contains for others
      const newMode = searchField === 'execution_id' ? 'exact' : 'contains';
      if (newMode !== activeSearchMode) {
        setActiveSearchMode(newMode);
        if (typeof window !== 'undefined') {
          localStorage.setItem('executions-filter-search-mode', newMode);
        }
      }

      // If there's an active search, refetch with new field and mode
      if (activeSearchFilter) {
        fetchExecutions(
          true,
          activeWorkflowFilter,
          activeStatusFilter,
          activeMachineFilter,
          activeSearchFilter,
          searchField,
          newMode,
          currentPage,
          pageSize
        );
      }
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchMode,
      currentPage,
      pageSize,
    ]
  );

  const handleSearchModeChange = useCallback(
    (searchMode: string) => {
      setActiveSearchMode(searchMode);
      if (typeof window !== 'undefined') {
        localStorage.setItem('executions-filter-search-mode', searchMode);
      }
      // If there's an active search, refetch with new mode
      if (activeSearchFilter) {
        fetchExecutions(
          true,
          activeWorkflowFilter,
          activeStatusFilter,
          activeMachineFilter,
          activeSearchFilter,
          activeSearchField,
          searchMode,
          currentPage,
          pageSize
        );
      }
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchField,
      currentPage,
      pageSize,
    ]
  );

  const handlePageChange = useCallback(
    (newPage: number) => {
      posthog?.capture('dashboard_change_page', {
        page: newPage,
        timestamp: new Date().toISOString(),
      });

      setCurrentPage(newPage);
      fetchExecutions(
        true,
        activeWorkflowFilter,
        activeStatusFilter,
        activeMachineFilter,
        activeSearchFilter,
        activeSearchField,
        activeSearchMode,
        newPage,
        pageSize
      );
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchField,
      activeSearchMode,
      pageSize,
      posthog,
    ]
  );

  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      posthog?.capture('dashboard_change_page_size', {
        page_size: newPageSize,
        timestamp: new Date().toISOString(),
      });

      setPageSize(newPageSize);
      setCurrentPage(1); // Reset to first page when changing page size
      if (typeof window !== 'undefined') {
        localStorage.setItem('executions-page-size', newPageSize.toString());
      }
      fetchExecutions(
        true,
        activeWorkflowFilter,
        activeStatusFilter,
        activeMachineFilter,
        activeSearchFilter,
        activeSearchField,
        activeSearchMode,
        1,
        newPageSize
      );
    },
    [
      fetchExecutions,
      activeWorkflowFilter,
      activeStatusFilter,
      activeMachineFilter,
      activeSearchFilter,
      activeSearchField,
      activeSearchMode,
      posthog,
    ]
  );

  // Handlers
  const handleWorkflowCreated = useCallback(
    (_newWorkflow: any) => {
      fetchWorkflows(false);
    },
    [fetchWorkflows]
  );

  const handleQuickExecute = useCallback(
    async (workflowId: number) => {
      const workflow = workflows.find(w => w.id === workflowId);
      if (!workflow) return;

      posthog?.capture('dashboard_execute_workflow', {
        workflow_id: workflowId,
        workflow_name: workflow.name,
        timestamp: new Date().toISOString(),
      });

      setSelectedWorkflowForAction(workflow);
      setBatchTestOpen(true);
    },
    [workflows, posthog]
  );

  const _handleQuickEdit = useCallback(
    (workflowId: number) => {
      const workflow = workflows.find(w => w.id === workflowId);
      if (!workflow) return;

      setSelectedWorkflowForAction(workflow);
      setActionsDialogMode('rename');
      setActionsDialogOpen(true);
    },
    [workflows]
  );

  const handleQuickDuplicate = useCallback(
    (workflowId: number) => {
      const workflow = workflows.find(w => w.id === workflowId);
      if (!workflow) return;

      posthog?.capture('dashboard_duplicate_workflow', {
        workflow_id: workflowId,
        workflow_name: workflow.name,
        timestamp: new Date().toISOString(),
      });

      setSelectedWorkflowForAction(workflow);
      setActionsDialogMode('duplicate');
      setActionsDialogOpen(true);
    },
    [workflows, posthog]
  );

  const handleToggleCron = useCallback(
    async (workflowId: number) => {
      const workflow = workflows.find(w => w.id === workflowId);
      if (!workflow) return;

      posthog?.capture('dashboard_toggle_cron', {
        workflow_id: workflowId,
        workflow_name: workflow.name,
        action: !workflow.cron_enabled ? 'enable' : 'disable',
        timestamp: new Date().toISOString(),
      });

      try {
        const response = await fetch(
          `/api/remote-workflows/${workflowId}/cron`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !workflow.cron_enabled }),
          }
        );

        const result = await response.json();
        if (result.success) {
          fetchWorkflows(false);
        } else {
          console.error('Failed to toggle cron:', result.error);
          // Show user-friendly error notification
          if (response.status === 403) {
            toast.error('This action requires organization admin privileges');
          } else {
            toast.error(
              `Failed to toggle cron: ${result.error || 'Unknown error'}`
            );
          }
        }
      } catch (error) {
        console.error('Error toggling cron:', error);
        toast.error('Error toggling cron');
      }
    },
    [workflows, fetchWorkflows, posthog]
  );

  const handleManageOrganizations = useCallback(
    (workflowId: number) => {
      const workflow = workflows.find(w => w.id === workflowId);
      if (!workflow) return;

      posthog?.capture('dashboard_manage_organizations', {
        workflow_id: workflowId,
        workflow_name: workflow.name,
        timestamp: new Date().toISOString(),
      });

      setSelectedWorkflowForOrgAssignment(workflow);
      setOrgAssignmentOpen(true);
    },
    [workflows, posthog]
  );

  const handleDeleteWorkflow = useCallback(
    async (workflowId: number) => {
      const workflow = workflows.find(w => w.id === workflowId);
      if (!workflow) return;

      posthog?.capture('dashboard_delete_workflow', {
        workflow_id: workflowId,
        workflow_name: workflow.name,
        timestamp: new Date().toISOString(),
      });

      try {
        // Optimistic update - remove from UI immediately
        setWorkflows(prev => prev.filter(w => w.id !== workflowId));
        workflowsRef.current = workflowsRef.current.filter(
          w => w.id !== workflowId
        );

        // Delete from server
        const response = await fetch(`/api/remote-workflows/${workflowId}`, {
          method: 'DELETE',
        });
        const data = await response.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to delete workflow');
        }

        toast.success(`Deleted workflow "${workflow.name}"`);

        // Refresh workflows and stats after a short delay
        setTimeout(() => {
          fetchWorkflows(false);
        }, 500);
      } catch (err) {
        // Revert optimistic update on error
        await fetchWorkflows(false);
        const errorMessage =
          err instanceof Error ? err.message : 'Unknown error';
        toast.error(`Failed to delete workflow: ${errorMessage}`);
        throw err;
      }
    },
    [workflows, fetchWorkflows, posthog]
  );

  // Initial data loading and refetch when viewOrgId changes
  useEffect(() => {
    const initializeData = async () => {
      // Start fetching workflows, live executions, and filters in parallel
      const workflowsPromise = fetchWorkflows();
      const liveExecutionsPromise = fetchLiveExecutions();
      const filtersPromise = fetchExecutionFilters();

      // Wait for workflows to complete (needed for executions filter to work correctly)
      await workflowsPromise;

      // Now fetch executions with saved filters (workflow lookup will work)
      const executionsPromise = fetchExecutions(
        true,
        activeWorkflowFilter,
        activeStatusFilter,
        activeMachineFilter,
        activeSearchFilter,
        activeSearchField,
        activeSearchMode,
        currentPage,
        pageSize
      );

      // Wait for all remaining requests to complete
      await Promise.all([
        executionsPromise,
        liveExecutionsPromise,
        filtersPromise,
      ]);
    };
    initializeData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fetchWorkflows,
    fetchLiveExecutions,
    fetchExecutionFilters,
    viewOrgId,
    organization?.id,
  ]);

  // Polling for workflows and executions - always poll to catch changes
  useEffect(() => {
    let localPollCount = 0;
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
          activeSearchModeRef.current,
          currentPageRef.current,
          pageSizeRef.current
        );
      }

      // Fetch workflows every 10 seconds (every 4th poll) to update stats, version info, and cron schedules
      // This keeps success rates, average durations, total execution counts, and next scheduled times up-to-date
      if (localPollCount % 4 === 0) {
        fetchWorkflows(false);
      }
    }, 2500); // Poll every 2.5 seconds

    return () => clearInterval(pollTimer);
  }, [fetchLiveExecutions, fetchExecutions, fetchWorkflows]); // Only depends on fetch functions, not filter values

  // Handle URL parameters for deep linking
  useEffect(() => {
    if (loading) return;

    const executionId = searchParams.get('execution');
    const workflowId = searchParams.get('workflow');

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
  }, [
    loading,
    searchParams,
    executionDetailsOpen,
    selectedWorkflow,
    workflows,
    fetchExecutionDetails,
    fetchWorkflowOverview,
  ]);

  // Check if user has admin privileges
  const hasMediarEmail =
    user?.emailAddresses?.some(email =>
      email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

  const isMemberOfMediarOrg =
    userMemberships?.data?.some(membership =>
      MEDIAR_ORG_IDS.includes(membership.organization.id)
    ) || false;

  const _isMediarOrg =
    organization?.id && MEDIAR_ORG_IDS.includes(organization.id);
  const isGlobalAdmin = hasMediarEmail || isMemberOfMediarOrg;
  const canDelete = isGlobalAdmin;

  // Show loading while Clerk is initializing or while redirecting
  if (!isLoaded || !userId) {
    return (
      <DashboardLayout>
        <div className="p-4">
          <div className="max-w-7xl mx-auto">
            <PageHeader
              title="Dashboard"
              subtitle="Welcome back to your workspace"
            />

            {/* Stats Bar Skeleton */}
            <div className="border-2 border-black p-2 mb-4 flex items-center gap-6">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="w-4 h-4" />
                  <div className="flex items-baseline gap-1.5">
                    <Skeleton className="w-24 h-4" />
                    <Skeleton className="w-12 h-5" />
                  </div>
                </div>
              ))}
            </div>

            {/* Header Skeleton */}
            <div className="flex items-center justify-between mb-3">
              <Skeleton className="w-40 h-4" />
              <div className="flex items-center gap-2">
                <Skeleton className="w-32 h-10" />
                <Skeleton className="w-40 h-10" />
              </div>
            </div>

            {/* Workflow Cards Skeleton */}
            <div className="border-2 border-black divide-y divide-gray-200 mb-4">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="p-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Name and status */}
                    <div className="flex items-center gap-2 min-w-[200px] max-w-[320px] flex-shrink">
                      <Skeleton className="w-32 h-5" />
                      <Skeleton className="w-12 h-4" />
                    </div>

                    <div className="text-gray-300">|</div>

                    {/* Metrics */}
                    <div className="flex items-center gap-2 flex-1">
                      <Skeleton className="w-16 h-4" />
                      <Skeleton className="w-12 h-4" />
                      <Skeleton className="w-12 h-4" />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-auto">
                      <Skeleton className="w-16 h-8" />
                      <Skeleton className="w-20 h-8" />
                      <Skeleton className="w-8 h-8" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

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
            <>
              {/* Stats Bar Skeleton */}
              <div className="border-2 border-black p-2 mb-4 flex items-center gap-6">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex items-center gap-2">
                    <Skeleton className="w-4 h-4" />
                    <div className="flex items-baseline gap-1.5">
                      <Skeleton className="w-24 h-4" />
                      <Skeleton className="w-12 h-5" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Header Skeleton */}
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="w-40 h-4" />
                <div className="flex items-center gap-2">
                  <Skeleton className="w-32 h-10" />
                  <Skeleton className="w-40 h-10" />
                </div>
              </div>

              {/* Workflow Cards Skeleton */}
              <div className="border-2 border-black divide-y divide-gray-200 mb-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="p-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Name and status */}
                      <div className="flex items-center gap-2 min-w-[200px] max-w-[320px] flex-shrink">
                        <Skeleton className="w-32 h-5" />
                        <Skeleton className="w-12 h-4" />
                      </div>

                      <div className="text-gray-300">|</div>

                      {/* Metrics */}
                      <div className="flex items-center gap-2 flex-1">
                        <Skeleton className="w-16 h-4" />
                        <Skeleton className="w-12 h-4" />
                        <Skeleton className="w-12 h-4" />
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 ml-auto">
                        <Skeleton className="w-16 h-8" />
                        <Skeleton className="w-20 h-8" />
                        <Skeleton className="w-8 h-8" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              {/* Stats Bar - Inline */}
              <div className="border-2 border-black p-2 mb-4 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  {stats.map(stat => {
                    const Icon = stat.icon;
                    return (
                      <div key={stat.label} className="flex items-center gap-2">
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-sm font-medium text-gray-600 uppercase">
                            {stat.label}
                          </span>
                          <span className="font-mono text-lg font-bold">
                            {stat.value}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <CreditsDisplay balance={userCredits} />
                  <button
                    onClick={() => {
                      posthog?.capture('dashboard_launch_vm_click', {
                        timestamp: new Date().toISOString(),
                      });
                      setLaunchVmOpen(true);
                    }}
                    className="px-4 py-1.5 bg-black text-white hover:bg-gray-800 transition-all flex items-center gap-2 text-sm font-mono"
                  >
                    <Monitor className="w-4 h-4" />
                    <span className="uppercase text-xs">New Sandbox</span>
                  </button>
                </div>
              </div>

              {/* Header with Actions */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-bold font-mono uppercase">
                    Available Workflows
                  </h2>
                  {/* Tag Filter Dropdown (session only, no localStorage) */}
                  {allWorkflowTags.length > 0 && (
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedWorkflowTags[0] || ''}
                        onChange={e => {
                          const tag = e.target.value;
                          if (tag) {
                            setSelectedWorkflowTags([tag]);
                          } else {
                            setSelectedWorkflowTags([]);
                          }
                        }}
                        className="h-7 px-2 text-[11px] font-mono border-2 border-black bg-white focus:outline-none"
                      >
                        <option value="">All Tags</option>
                        {allWorkflowTags.map(tag => (
                          <option key={tag} value={tag}>
                            {tag}
                          </option>
                        ))}
                      </select>
                      {selectedWorkflowTags.length > 0 && (
                        <button
                          onClick={() => setSelectedWorkflowTags([])}
                          className="h-7 px-2 text-[11px] font-mono border-2 border-black hover:bg-black hover:text-white transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {/* Command Bar */}
                  <button
                    onClick={() => {
                      posthog?.capture('dashboard_open_command_palette', {
                        timestamp: new Date().toISOString(),
                      });
                      setCommandPaletteOpen(true);
                    }}
                    className="px-4 py-2 bg-white border-2 border-black hover:bg-black hover:text-white transition-all flex items-center gap-2 text-sm min-h-[42px]"
                    aria-label="Open command palette"
                  >
                    <Search className="w-4 h-4" />
                    <span className="font-mono text-xs uppercase">Search</span>
                    <kbd className="ml-2 px-1.5 py-0.5 text-xs bg-white text-black border border-black rounded font-mono">
                      {typeof window !== 'undefined' &&
                      navigator.platform.toLowerCase().includes('mac')
                        ? '⌘'
                        : 'Ctrl'}
                      K
                    </kbd>
                  </button>

                  <a
                    href="https://mediar.ai/turnkey"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      posthog?.capture('dashboard_turnkey_automation_click', {
                        timestamp: new Date().toISOString(),
                      });
                    }}
                    className="px-4 py-2 bg-white border-2 border-black hover:bg-black hover:text-white transition-all flex items-center gap-2 text-sm min-h-[42px]"
                    aria-label="Turn recording into automation"
                  >
                    <Wand2 className="w-4 h-4" />
                    <span className="font-mono text-xs uppercase">
                      Turnkey Automation
                    </span>
                  </a>
                </div>
              </div>

              {/* Tag Pills (when multiple tags selected or for quick access) */}
              {selectedWorkflowTags.length > 1 && (
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="text-[11px] font-mono text-gray-500">
                    Active filters:
                  </span>
                  {selectedWorkflowTags.map(tag => (
                    <button
                      key={tag}
                      onClick={() => toggleTagFilter(tag)}
                      className="h-6 px-2 text-[11px] font-mono border-2 bg-black text-white border-black flex items-center gap-1"
                    >
                      {tag}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                  <button
                    onClick={() => setSelectedWorkflowTags([])}
                    className="h-6 px-2 text-[11px] font-mono text-gray-500 hover:text-black flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    Clear all
                  </button>
                </div>
              )}

              {/* Workflows List */}
              <div className="mb-4">
                {filteredWorkflows.length > 0 ? (
                  <div className="border-2 border-black divide-y divide-gray-200">
                    {filteredWorkflows.map((workflow, index) => (
                      <WorkflowCardEnhanced
                        key={workflow.id}
                        workflow={workflow}
                        executions={executions.filter(
                          e => e.workflow_id === workflow.id
                        )}
                        liveExecutions={liveExecutions}
                        isSelected={selectedIndex === index}
                        onSelect={() => setSelectedIndex(index)}
                        onExecute={() => handleQuickExecute(workflow.id)}
                        onView={() => fetchWorkflowOverview(workflow.id)}
                        onToggleCron={() => handleToggleCron(workflow.id)}
                        onManageOrganizations={() =>
                          handleManageOrganizations(workflow.id)
                        }
                        onDelete={handleDeleteWorkflow}
                        isMediarAdmin={!!isGlobalAdmin}
                      />
                    ))}
                  </div>
                ) : workflows.length > 0 ? (
                  <div className="text-center py-12 border-2 border-dashed border-black">
                    <p className="font-mono text-gray-600">
                      No workflows match selected tags.
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-12 border-2 border-dashed border-black">
                    <p className="font-mono text-gray-600">No workflows yet.</p>
                  </div>
                )}
              </div>

              {/* Recent Executions */}
              {initialExecutionsFetchDone &&
                (executions.length > 0 ||
                  executionsLoading ||
                  activeWorkflowFilter ||
                  activeStatusFilter ||
                  activeMachineFilter ||
                  activeSearchFilter) && (
                  <div className="space-y-3 mt-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold font-mono uppercase">
                        Recent Executions
                      </h2>
                      <div className="flex gap-2 items-center">
                        <span className="text-[11px] font-mono text-black">
                          Show:
                        </span>
                        <button
                          onClick={() => {
                            const newValue = !showQueuedExecutions;
                            setShowQueuedExecutions(newValue);
                            if (typeof window !== 'undefined') {
                              localStorage.setItem(
                                'showQueuedExecutions',
                                JSON.stringify(newValue)
                              );
                            }
                            handleRefreshExecutions();
                          }}
                          className={`h-7 px-3 text-[11px] font-mono transition-colors border-2 border-black ${
                            showQueuedExecutions
                              ? 'bg-black text-white'
                              : 'bg-white text-black hover:bg-gray-50'
                          }`}
                          title={
                            showQueuedExecutions
                              ? 'Hide queued executions'
                              : 'Show queued executions'
                          }
                        >
                          Queued
                        </button>
                        <button
                          onClick={() => {
                            const newValue = !showSkippedExecutions;
                            setShowSkippedExecutions(newValue);
                            if (typeof window !== 'undefined') {
                              localStorage.setItem(
                                'showSkippedExecutions',
                                JSON.stringify(newValue)
                              );
                            }
                            handleRefreshExecutions();
                          }}
                          className={`h-7 px-3 text-[11px] font-mono transition-colors border-2 border-black ${
                            showSkippedExecutions
                              ? 'bg-black text-white'
                              : 'bg-white text-black hover:bg-gray-50'
                          }`}
                          title={
                            showSkippedExecutions
                              ? 'Hide skipped executions'
                              : 'Show skipped executions'
                          }
                        >
                          Skipped
                        </button>
                      </div>
                    </div>

                    <ExecutionsDataTable
                      executions={executions.filter(e => {
                        if (!showQueuedExecutions && e.status === 'queued')
                          return false;
                        if (!showSkippedExecutions && e.status === 'skipped')
                          return false;
                        return true;
                      })}
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
                      onSearchModeChange={handleSearchModeChange}
                      onPageChange={handlePageChange}
                      onPageSizeChange={handlePageSizeChange}
                      activeWorkflowFilter={activeWorkflowFilter}
                      activeStatusFilter={activeStatusFilter}
                      activeMachineFilter={activeMachineFilter}
                      activeSearchFilter={activeSearchFilter}
                      activeSearchField={activeSearchField}
                      activeSearchMode={activeSearchMode}
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
          onRefresh={() => fetchWorkflows(true)}
        />

        {/* Launch VM Dialog */}
        <LaunchVmDialog
          open={launchVmOpen}
          onOpenChange={setLaunchVmOpen}
          userCredits={userCredits}
          onCreditsChange={fetchUserCredits}
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
          onOpenChange={open => {
            setWorkflowDetailsOpen(open);
            if (!open) {
              // Remove workflow parameter from URL when closing
              const params = new URLSearchParams(searchParams.toString());
              params.delete('workflow');
              router.replace(
                `/dashboard${params.toString() ? `?${params.toString()}` : ''}`
              );
            }
          }}
          onSettingsUpdated={() => fetchWorkflows(false)}
          isMediarTeam={isGlobalAdmin}
        />

        <ExecutionDetailsDialog
          execution={selectedExecution}
          open={executionDetailsOpen}
          onOpenChange={open => {
            setExecutionDetailsOpen(open);
            if (!open) {
              // Remove execution parameter from URL when closing
              const params = new URLSearchParams(searchParams.toString());
              params.delete('execution');
              router.replace(
                `/dashboard${params.toString() ? `?${params.toString()}` : ''}`
              );
            }
          }}
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
            isMediarTeam={isGlobalAdmin}
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
            onOpenChange={open => {
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
            onOpenChange={open => {
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
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto"></div>
          </div>
        </DashboardLayout>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
