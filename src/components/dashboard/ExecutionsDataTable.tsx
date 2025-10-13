'use client';

import * as React from 'react';
import { memo } from 'react';
import {
  ColumnDef,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowUpDown,
  ChevronDown,
  Eye,
  StopCircle,
  Trash2,
  MoreHorizontal,
  Search,
  Columns3,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RefreshCw,
  Filter,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Execution, LiveExecutionStatus, WorkflowWithSettings } from '@/lib/workflow-types';
import { cn } from '@/lib/utils';

interface ExecutionsDataTableProps {
  executions: Execution[];
  workflows: WorkflowWithSettings[];
  liveExecutions: LiveExecutionStatus[];
  loading?: boolean;
  canDelete?: boolean;
  onViewDetails: (executionId: number) => void;
  onCancelExecution?: (executionId: number) => Promise<void>;
  onDeleteExecution?: (executionId: number) => Promise<void>;
  onRefresh?: () => void;
  // Optional filter values from database (all unique values, not just current page)
  filterWorkflowNames?: string[];
  filterStatuses?: string[];
  filterMachines?: string[];
  // Server-side filter callbacks
  onWorkflowFilterChange?: (workflowName: string | undefined) => void;
  onStatusFilterChange?: (status: string | undefined) => void;
  onMachineFilterChange?: (machine: string | undefined) => void;
  onSearchFilterChange?: (search: string) => void;
  // Server-side pagination callbacks
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  // Active filter values (controlled from parent)
  activeWorkflowFilter?: string;
  activeStatusFilter?: string;
  activeMachineFilter?: string;
  activeSearchFilter?: string;
  // Server-side pagination state
  currentPage?: number;
  pageSize?: number;
  totalRecords?: number;
}

// Helper function to extract the most informative message from parser output
function getParserMessage(formattedResult: any, execution: Execution): string {
  // Priority 1: Error summary from parser (e.g., SAP workflows)
  if (formattedResult?.error_summary?.error_reason) {
    const reason = formattedResult.error_summary.error_reason;
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  }

  // Priority 2: Standard message field (if not the default)
  if (formattedResult?.message && formattedResult.message !== "No message from parser") {
    const message = formattedResult.message;
    return typeof message === 'string' ? message : JSON.stringify(message);
  }

  // Priority 3: Data summary field
  if (formattedResult?.data?.summary) {
    // Ensure summary is a string
    if (typeof formattedResult.data.summary === 'string') {
      return formattedResult.data.summary;
    }
    // If summary is an object, stringify it
    if (typeof formattedResult.data.summary === 'object') {
      return JSON.stringify(formattedResult.data.summary);
    }
  }

  // Priority 4: Failure details with financial state (SAP specific)
  if (formattedResult?.failure_details?.financial_state) {
    const state = formattedResult.failure_details.financial_state;
    if (state.difference) {
      return `Unbalanced: Debit=${state.debit_total} Credit=${state.credit_total} Diff=${state.difference}`;
    }
  }

  // Priority 5: Generic error field in data
  if (formattedResult?.data?.error) {
    const error = formattedResult.data.error;
    return typeof error === 'string' ? error : JSON.stringify(error);
  }

  // Priority 6: If data is an object, stringify it for display
  if (formattedResult?.data && typeof formattedResult.data === 'object') {
    try {
      // Format common data patterns
      if ('total_unprocessed' in formattedResult.data) {
        return `Unprocessed: ${formattedResult.data.total_unprocessed || 0}`;
      }
      // For other objects, show a summary
      const keys = Object.keys(formattedResult.data);
      if (keys.length > 0) {
        return `Data: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
      }
    } catch (e) {
      // Fallback if stringify fails
      return 'Data available';
    }
  }

  // Priority 7: Execution error message
  if (execution.error_message) {
    return execution.error_message;
  }

  // Default
  return '-';
}

// Helper function to determine execution status from parser output
function getExecutionStatus(execution: Execution, formattedResult: any, isLive: boolean): { badge: string; badgeColor: string } {
  // Check if currently running
  if (execution.status === 'running' || isLive) {
    return { badge: 'RUNNING', badgeColor: 'bg-black text-white animate-pulse' };
  }

  // Check for exception status (highest priority after running)
  if (formattedResult?.exception === true) {
    return { badge: 'EXCEPTION', badgeColor: 'bg-black text-white font-bold border-2 border-black' };
  }

  // Check parser-determined status
  if (formattedResult?.meta_type === 'failed' || formattedResult?.status === 'failed') {
    return { badge: 'FAILED', badgeColor: 'bg-black text-white font-bold' };
  }

  // Check for error summary (indicates failure)
  if (formattedResult?.error_summary) {
    return { badge: 'FAILED', badgeColor: 'bg-black text-white font-bold' };
  }

  // Check skipped status
  if (formattedResult?.skipped || execution.status === 'skipped') {
    return { badge: 'SKIPPED', badgeColor: 'bg-gray-200 text-gray-800' };
  }

  // Check success/failure from parser
  if (formattedResult?.success === false) {
    return { badge: 'FAILED', badgeColor: 'bg-black text-white font-bold' };
  }
  if (formattedResult?.success === true) {
    return { badge: 'COMPLETED', badgeColor: 'bg-white border-2 border-black' };
  }

  // Fall back to execution status
  switch (execution.status) {
    case 'error':
    case 'timeout':
      return { badge: execution.status.toUpperCase(), badgeColor: 'bg-black text-white font-bold' };
    case 'completed':
      return { badge: 'COMPLETED', badgeColor: 'bg-white border-2 border-black' };
    case 'failed':
      return { badge: 'FAILED', badgeColor: 'bg-black text-white font-bold' };
    case 'cancelled':
      return { badge: 'CANCELLED', badgeColor: 'bg-gray-200 text-gray-800' };
    default:
      return { badge: execution.status.toUpperCase(), badgeColor: 'bg-gray-200 text-gray-800' };
  }
}

export const ExecutionsDataTable = memo(function ExecutionsDataTable({
  executions,
  workflows,
  liveExecutions,
  loading = false,
  canDelete = false,
  onViewDetails,
  onCancelExecution,
  onDeleteExecution,
  onRefresh,
  filterWorkflowNames,
  filterStatuses,
  filterMachines,
  onWorkflowFilterChange,
  onStatusFilterChange,
  onMachineFilterChange,
  onSearchFilterChange,
  onPageChange,
  onPageSizeChange,
  activeWorkflowFilter,
  activeStatusFilter,
  activeMachineFilter,
  activeSearchFilter,
  currentPage = 1,
  pageSize: serverPageSize = 100,
  totalRecords = 0,
}: ExecutionsDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    {
      id: 'started_at',
      desc: true,
    },
  ]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(() => {
    // Load saved column visibility from localStorage or use defaults
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('executions-table-columns');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse saved column visibility:', e);
        }
      }
    }
    // Default column visibility
    return {
      execution_id: false,  // Hide execution ID by default
      workflow_id: false,  // Hide workflow ID by default
      workflow_name: true, // Show workflow name by default
      error_message: false,
      machine: true,  // Show machine by default (updated from false)
      user: false,
      version: false,
    };
  });
  const [rowSelection, setRowSelection] = React.useState({});

  // Track which executions are being stopped/deleted
  const [stoppingExecutions, setStoppingExecutions] = React.useState<Set<number>>(new Set());
  const [deletingExecutions, setDeletingExecutions] = React.useState<Set<number>>(new Set());

  // Track which dropdown is open to preserve state during re-renders
  const [openDropdownId, setOpenDropdownId] = React.useState<number | null>(null);

  // Local search input state (controlled input, only triggers API on Enter/Button)
  const [localSearchValue, setLocalSearchValue] = React.useState(activeSearchFilter || '');

  // Sync local search value when active filter changes (e.g., cleared from parent)
  React.useEffect(() => {
    setLocalSearchValue(activeSearchFilter || '');
  }, [activeSearchFilter]);

  // Handler to trigger search (called by Enter key or Search button)
  const handleSearch = React.useCallback(() => {
    if (onSearchFilterChange) {
      onSearchFilterChange(localSearchValue);
    }
  }, [localSearchValue, onSearchFilterChange]);

  // Handler to clear search
  const handleClearSearch = React.useCallback(() => {
    setLocalSearchValue('');
    if (onSearchFilterChange) {
      onSearchFilterChange('');
    }
  }, [onSearchFilterChange]);

  // Save column visibility to localStorage whenever it changes
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('executions-table-columns', JSON.stringify(columnVisibility));
    }
  }, [columnVisibility]);

  const columns: ColumnDef<Execution>[] = React.useMemo(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected();
            }}
            onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
            className="h-3 w-3 border border-black focus:ring-1 focus:ring-black"
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={(e) => row.toggleSelected(!!e.target.checked)}
            className="h-3 w-3 border border-black focus:ring-1 focus:ring-black"
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: 'execution_id',
        header: 'ID',
        cell: ({ row }) => (
          <span className="font-mono text-[10px]">{row.getValue('execution_id')}</span>
        ),
      },
      {
        accessorKey: 'workflow_id',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Workflow ID
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => {
          return (
            <span className="font-mono text-[10px]">
              {row.getValue('workflow_id')}
            </span>
          );
        },
      },
      {
        id: 'workflow_name',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Workflow Name
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        accessorFn: (row) => {
          const workflow = workflows.find((w) => w.id === row.workflow_id);
          return workflow?.name || `Workflow ${row.workflow_id}`;
        },
        cell: ({ row }) => {
          const workflow = workflows.find((w) => w.id === row.original.workflow_id);
          return (
            <span className="font-mono text-xs">
              {workflow?.name || `Workflow ${row.original.workflow_id}`}
            </span>
          );
        },
        filterFn: (row, columnId, filterValue) => {
          if (!filterValue) return true; // Show all if no filter
          const workflow = workflows.find((w) => w.id === row.original.workflow_id);
          const workflowName = workflow?.name || `Workflow ${row.original.workflow_id}`;
          return workflowName === filterValue;
        },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Status
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => {
          const execution = row.original;
          const isLive = liveExecutions.some((le) => le.id === execution.execution_id);

          // Parse formatted_output if it exists
          let formattedResult = null;
          if (execution.formatted_output) {
            try {
              formattedResult =
                typeof execution.formatted_output === 'string'
                  ? JSON.parse(execution.formatted_output)
                  : execution.formatted_output;
            } catch (e) {
              formattedResult = null;
            }
          }

          // Use the helper function to get status
          const { badge, badgeColor } = getExecutionStatus(execution, formattedResult, isLive);

          return (
            <span className={cn('font-mono text-[10px] px-1 py-0.5 inline-block', badgeColor)}>
              {badge}
            </span>
          );
        },
      },
      {
        accessorKey: 'formatted_output',
        header: 'Message',
        cell: ({ row }) => {
          const execution = row.original;
          let formattedResult = null;
          if (execution.formatted_output) {
            try {
              formattedResult =
                typeof execution.formatted_output === 'string'
                  ? JSON.parse(execution.formatted_output)
                  : execution.formatted_output;
            } catch (e) {
              formattedResult = null;
            }
          }

          // Use the helper function to get the message
          const message = getParserMessage(formattedResult, execution);
          const truncatedMessage = message.length > 80 ? message.substring(0, 80) + '...' : message;

          return (
            <div className="max-w-[250px] truncate">
              <span className="font-mono text-[10px] text-gray-700" title={message}>
                {truncatedMessage}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'error_message',
        header: 'Error',
        cell: ({ row }) => {
          const message = row.getValue('error_message') as string;
          if (!message) return <span className="text-[10px]">-</span>;
          const truncated = message.length > 50 ? message.substring(0, 50) + '...' : message;
          return (
            <span className="font-mono text-[10px] text-red-600" title={message}>
              {truncated}
            </span>
          );
        },
      },
      {
        accessorKey: 'started_at',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Started
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => {
          const execution = row.original;
          const date = new Date(execution.started_at || execution.created_at);
          return <span className="font-mono text-[10px]">{date.toLocaleString()}</span>;
        },
      },
      {
        id: 'duration',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Duration
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        accessorFn: (row) => {
          if (row.completed_at && row.started_at) {
            return (
              new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()
            ) / 1000;
          }
          return 0;
        },
        cell: ({ row }) => {
          const execution = row.original;
          const isLive = liveExecutions.some((le) => le.id === execution.execution_id);

          if (execution.completed_at && execution.started_at) {
            const duration = Math.round(
              (new Date(execution.completed_at).getTime() -
                new Date(execution.started_at).getTime()) /
                1000
            );
            return <span className="font-mono text-[10px]">{duration}s</span>;
          } else if (isLive || execution.status === 'running') {
            return <span className="font-mono text-[10px] animate-pulse">Running...</span>;
          }
          return <span className="font-mono text-[10px]">-</span>;
        },
      },
      {
        id: 'machine',
        accessorFn: (row) => row.assigned_machine_name || '',
        header: 'Machine',
        cell: ({ row }) => {
          const machineName = row.original.assigned_machine_name;
          return (
            <span className="font-mono text-[10px] text-gray-600">
              {machineName || '-'}
            </span>
          );
        },
        filterFn: (row, columnId, filterValue) => {
          if (!filterValue) return true; // Show all if no filter
          const machineValue = row.original.assigned_machine_name || '';
          return machineValue === filterValue;
        },
      },
      {
        id: 'user',
        accessorKey: 'client_id',
        header: 'User',
        cell: ({ row }) => {
          const clientId = row.getValue('client_id') as string;
          return (
            <span className="font-mono text-[10px] text-gray-600">
              {clientId || '-'}
            </span>
          );
        },
      },
      {
        id: 'version',
        header: 'Version',
        cell: ({ row }) => {
          const workflow = workflows.find((w) => w.id === row.original.workflow_id);
          return (
            <span className="font-mono text-[10px] text-gray-600">
              v{workflow?.version || '1.0'}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const execution = row.original;
          const isRunning = execution.status === 'running' || execution.status === 'queued';
          const isStopping = stoppingExecutions.has(execution.execution_id);
          const isDeleting = deletingExecutions.has(execution.execution_id);

          return (
            <DropdownMenu
              modal={false}
              open={openDropdownId === execution.execution_id}
              onOpenChange={(open) => {
                setOpenDropdownId(open ? execution.execution_id : null);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-6 w-6 p-0 border border-black hover:bg-black hover:text-white"
                >
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-2 border-black">
                <DropdownMenuLabel className="font-mono uppercase">Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setOpenDropdownId(null);
                    onViewDetails(execution.execution_id);
                  }}
                  className="font-mono text-sm hover:bg-gray-100"
                >
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                {isRunning && onCancelExecution && (
                  <DropdownMenuItem
                    onClick={async () => {
                      setOpenDropdownId(null);
                      if (
                        confirm(
                          `Are you sure you want to ${
                            execution.status === 'queued' ? 'cancel' : 'stop'
                          } this execution?`
                        )
                      ) {
                        setStoppingExecutions((prev) => new Set(prev).add(execution.execution_id));
                        try {
                          await onCancelExecution(execution.execution_id);
                        } finally {
                          setStoppingExecutions((prev) => {
                            const newSet = new Set(prev);
                            newSet.delete(execution.execution_id);
                            return newSet;
                          });
                        }
                      }
                    }}
                    disabled={isStopping}
                    className="font-mono text-sm hover:bg-gray-100"
                  >
                    <StopCircle className="mr-2 h-4 w-4" />
                    {execution.status === 'queued' ? 'Cancel' : 'Stop'}
                  </DropdownMenuItem>
                )}
                {canDelete && onDeleteExecution && (
                  <DropdownMenuItem
                    onClick={async () => {
                      setOpenDropdownId(null);
                      if (
                        confirm(
                          `Are you sure you want to DELETE this execution? This cannot be undone.`
                        )
                      ) {
                        setDeletingExecutions((prev) => new Set(prev).add(execution.execution_id));
                        try {
                          await onDeleteExecution(execution.execution_id);
                        } finally {
                          setDeletingExecutions((prev) => {
                            const newSet = new Set(prev);
                            newSet.delete(execution.execution_id);
                            return newSet;
                          });
                        }
                      }
                    }}
                    disabled={isDeleting}
                    className="font-mono text-sm hover:bg-red-100 hover:text-red-900"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [
      workflows,
      liveExecutions,
      stoppingExecutions,
      deletingExecutions,
      canDelete,
      onViewDetails,
      onCancelExecution,
      onDeleteExecution,
      openDropdownId,
    ]
  );

  // Calculate total pages based on server-side total
  const totalPages = Math.ceil(totalRecords / serverPageSize);

  const table = useReactTable({
    data: executions,
    columns,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true, // Server-side pagination
    manualFiltering: true, // Server-side filtering
    manualSorting: true, // Server-side sorting (already sorted by API)
    pageCount: totalPages,
    getRowId: (row) => `execution-${row.execution_id}`, // Use stable execution ID
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination: {
        pageIndex: currentPage - 1, // TanStack uses 0-based index
        pageSize: serverPageSize,
      },
    },
  });


  // Get unique workflow names for filter (use prop if provided, else compute from executions)
  const uniqueWorkflowNames = React.useMemo(() => {
    if (filterWorkflowNames) return filterWorkflowNames;
    const names = new Set<string>();
    executions.forEach((execution) => {
      const workflow = workflows.find((w) => w.id === execution.workflow_id);
      if (workflow?.name) {
        names.add(workflow.name);
      }
    });
    return Array.from(names).sort();
  }, [executions, workflows, filterWorkflowNames]);

  // Get unique statuses for filter (use prop if provided, else compute from executions)
  const uniqueStatuses = React.useMemo(() => {
    if (filterStatuses) return filterStatuses;
    const statuses = new Set<string>();
    executions.forEach((execution) => {
      statuses.add(execution.status);
    });
    return Array.from(statuses).sort();
  }, [executions, filterStatuses]);

  // Get unique machines for filter (use prop if provided, else compute from executions)
  const uniqueMachines = React.useMemo(() => {
    if (filterMachines) return filterMachines;
    const machines = new Set<string>();
    executions.forEach((execution) => {
      if (execution.assigned_machine_name) {
        machines.add(execution.assigned_machine_name);
      }
    });
    return Array.from(machines).sort();
  }, [executions, filterMachines]);

  return (
    <div className="w-full">
      <style dangerouslySetInnerHTML={{__html: `
        .executions-table-wrapper::-webkit-scrollbar {
          height: 14px;
        }
        .executions-table-wrapper::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-top: 2px solid black;
        }
        .executions-table-wrapper::-webkit-scrollbar-thumb {
          background: black;
          border: 1px solid black;
        }
        .executions-table-wrapper {
          overflow-x: scroll !important;
          scrollbar-width: thin;
          scrollbar-color: black #f1f1f1;
        }
      `}} />
      {/* Table Controls */}
      <div className="flex flex-col gap-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-600" />
              <Input
                placeholder="Search executions... (press Enter)"
                value={localSearchValue}
                onChange={(event) => {
                  setLocalSearchValue(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSearch();
                  }
                }}
                className="h-8 pl-7 pr-7 text-xs font-mono border-2 border-black focus:ring-2 focus:ring-black"
              />
              {localSearchValue && (
                <button
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-black"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearch}
              className="h-8 text-xs border-2 border-black hover:bg-black hover:text-white"
            >
              <Search className="mr-1 h-3 w-3" />
              SEARCH
            </Button>
            {table.getFilteredSelectedRowModel().rows.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 font-mono">
                  {table.getFilteredSelectedRowModel().rows.length} selected
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => table.toggleAllRowsSelected(false)}
                  className="h-7 text-xs border-2 border-black hover:bg-black hover:text-white"
                >
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                className="h-7 w-7 p-0 border-2 border-black hover:bg-black hover:text-white"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs border-2 border-black hover:bg-black hover:text-white"
                >
                  <Columns3 className="mr-1 h-3 w-3" />
                  Columns
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-2 border-black">
                <DropdownMenuLabel className="font-mono uppercase text-xs">
                  Toggle Columns
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="font-mono text-sm capitalize hover:bg-gray-100"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      >
                        {column.id.replace(/_/g, ' ')}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Column Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Filter className="h-3 w-3 text-gray-600" />
            <span className="text-xs font-mono text-gray-600 uppercase">Filters:</span>
          </div>

          {/* Workflow Name Filter */}
          <select
            value={activeWorkflowFilter ?? ''}
            onChange={(e) => {
              const value = e.target.value || undefined;
              if (onWorkflowFilterChange) {
                onWorkflowFilterChange(value);
              }
            }}
            className="h-7 px-2 py-0 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">All Workflows</option>
            {uniqueWorkflowNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={activeStatusFilter ?? ''}
            onChange={(e) => {
              const value = e.target.value || undefined;
              if (onStatusFilterChange) {
                onStatusFilterChange(value);
              }
            }}
            className="h-7 px-2 py-0 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">All Statuses</option>
            {uniqueStatuses.map((status) => (
              <option key={status} value={status}>
                {status.toUpperCase()}
              </option>
            ))}
          </select>

          {/* Machine Filter */}
          <select
            value={activeMachineFilter ?? ''}
            onChange={(e) => {
              const value = e.target.value || undefined;
              if (onMachineFilterChange) {
                onMachineFilterChange(value);
              }
            }}
            className="h-7 px-2 py-0 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black"
          >
            <option value="">All Machines</option>
            {uniqueMachines.map((machine) => (
              <option key={machine} value={machine}>
                {machine}
              </option>
            ))}
          </select>

          {/* Clear Filters Button */}
          {(activeWorkflowFilter || activeStatusFilter || activeMachineFilter || activeSearchFilter) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Clear all server-side filters
                if (onWorkflowFilterChange) onWorkflowFilterChange(undefined);
                if (onStatusFilterChange) onStatusFilterChange(undefined);
                if (onMachineFilterChange) onMachineFilterChange(undefined);
                if (onSearchFilterChange) onSearchFilterChange('');
              }}
              className="h-7 text-xs border-2 border-black hover:bg-black hover:text-white"
            >
              <X className="mr-1 h-3 w-3" />
              Clear Filters
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border-2 border-black executions-table-wrapper">
          <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-black hover:bg-black">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className="text-white font-mono font-bold uppercase text-[10px] py-1 px-2"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={`skeleton-${index}`} className="h-8">
                  {columns.map((column, colIndex) => (
                    <TableCell key={`${column.id || colIndex}`} className="py-1 px-2">
                      <Skeleton className="h-3 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                  className="hover:bg-gray-50 h-8 cursor-pointer"
                  onClick={() => onViewDetails(row.original.execution_id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="font-mono py-1 px-2"
                      onClick={(e) => {
                        // Prevent row click when clicking on interactive elements (checkboxes, action buttons)
                        if (cell.column.id === 'select' || cell.column.id === 'actions') {
                          e.stopPropagation();
                        }
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-12 text-center">
                  <p className="text-gray-600 font-mono text-xs">No executions found.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between py-2">
        <div className="text-xs text-gray-600 font-mono">
          Showing {executions.length > 0 ? (currentPage - 1) * serverPageSize + 1 : 0} to{' '}
          {Math.min(currentPage * serverPageSize, totalRecords)} of {totalRecords} executions
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange && onPageChange(1)}
              disabled={currentPage === 1}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronsLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange && onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <span className="font-mono text-xs">
              Page {currentPage} of {totalPages || 1}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange && onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange && onPageChange(totalPages)}
              disabled={currentPage >= totalPages}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronsRight className="h-3 w-3" />
            </Button>
          </div>

          <select
            value={serverPageSize}
            onChange={(e) => {
              if (onPageSizeChange) {
                onPageSizeChange(Number(e.target.value));
              }
            }}
            className="ml-2 h-7 px-2 py-0 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black"
          >
            {[25, 50, 100, 200].map((size) => (
              <option key={size} value={size}>
                Show {size}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
});