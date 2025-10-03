'use client';

import * as React from 'react';
import { memo } from 'react';
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
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
}

// Helper function to extract the most informative message from parser output
function getParserMessage(formattedResult: any, execution: Execution): string {
  // Priority 1: Error summary from parser (e.g., SAP workflows)
  if (formattedResult?.error_summary?.error_reason) {
    return formattedResult.error_summary.error_reason;
  }

  // Priority 2: Standard message field (if not the default)
  if (formattedResult?.message && formattedResult.message !== "No message from parser") {
    return formattedResult.message;
  }

  // Priority 3: Data summary field
  if (formattedResult?.data?.summary) {
    return formattedResult.data.summary;
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
    return formattedResult.data.error;
  }

  // Priority 6: Execution error message
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

  // Check parser-determined status first
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
}: ExecutionsDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    {
      id: 'started_at',
      desc: true,
    },
  ]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
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
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [rowSelection, setRowSelection] = React.useState({});

  // Track which executions are being stopped/deleted
  const [stoppingExecutions, setStoppingExecutions] = React.useState<Set<number>>(new Set());
  const [deletingExecutions, setDeletingExecutions] = React.useState<Set<number>>(new Set());

  // Track which dropdown is open to preserve state during re-renders
  const [openDropdownId, setOpenDropdownId] = React.useState<number | null>(null);

  // Save column visibility to localStorage whenever it changes
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('executions-table-columns', JSON.stringify(columnVisibility));
    }
  }, [columnVisibility]);

  // Reset to first page when filters change
  React.useEffect(() => {
    table.setPageIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters, globalFilter]);

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

  const table = useReactTable({
    data: executions,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => `execution-${row.execution_id}`, // Use stable execution ID
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  // Get unique workflow names for filter
  const uniqueWorkflowNames = React.useMemo(() => {
    const names = new Set<string>();
    executions.forEach((execution) => {
      const workflow = workflows.find((w) => w.id === execution.workflow_id);
      if (workflow?.name) {
        names.add(workflow.name);
      }
    });
    return Array.from(names).sort();
  }, [executions, workflows]);

  // Get unique statuses for filter
  const uniqueStatuses = React.useMemo(() => {
    const statuses = new Set<string>();
    executions.forEach((execution) => {
      statuses.add(execution.status);
    });
    return Array.from(statuses).sort();
  }, [executions]);

  // Get unique machines for filter
  const uniqueMachines = React.useMemo(() => {
    const machines = new Set<string>();
    executions.forEach((execution) => {
      if (execution.assigned_machine_name) {
        machines.add(execution.assigned_machine_name);
      }
    });
    return Array.from(machines).sort();
  }, [executions]);

  // Active filters count
  const activeFiltersCount = columnFilters.length;

  return (
    <div className="w-full">
      {/* Table Controls */}
      <div className="flex flex-col gap-2 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-600" />
              <Input
                placeholder="Search executions..."
                value={globalFilter ?? ''}
                onChange={(event) => setGlobalFilter(event.target.value)}
                className="h-8 pl-7 text-xs font-mono border-2 border-black focus:ring-2 focus:ring-black"
              />
            </div>
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
            value={(table.getColumn('workflow_name')?.getFilterValue() as string) ?? ''}
            onChange={(e) => table.getColumn('workflow_name')?.setFilterValue(e.target.value || undefined)}
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
            value={(table.getColumn('status')?.getFilterValue() as string) ?? ''}
            onChange={(e) => table.getColumn('status')?.setFilterValue(e.target.value || undefined)}
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
            value={(table.getColumn('machine')?.getFilterValue() as string) ?? ''}
            onChange={(e) => table.getColumn('machine')?.setFilterValue(e.target.value || undefined)}
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
          {activeFiltersCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.resetColumnFilters()}
              className="h-7 text-xs border-2 border-black hover:bg-black hover:text-white"
            >
              <X className="mr-1 h-3 w-3" />
              Clear Filters ({activeFiltersCount})
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="border-2 border-black">
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
                  className="hover:bg-gray-50 h-8"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="font-mono py-1 px-2">
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
          {table.getFilteredSelectedRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} row(s) selected.
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronsLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <span className="font-mono text-xs">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              className="h-7 w-7 p-0 border border-black hover:bg-black hover:text-white disabled:opacity-50"
            >
              <ChevronsRight className="h-3 w-3" />
            </Button>
          </div>

          <select
            value={table.getState().pagination.pageSize}
            onChange={(e) => {
              table.setPageSize(Number(e.target.value));
            }}
            className="ml-2 h-7 px-2 py-0 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black"
          >
            {[10, 20, 30, 40, 50].map((pageSize) => (
              <option key={pageSize} value={pageSize}>
                Show {pageSize}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
});