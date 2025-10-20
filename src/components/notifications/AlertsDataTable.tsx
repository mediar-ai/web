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
  RefreshCw,
  Search,
  X,
  ExternalLink,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { cn } from '@/lib/utils';
import Link from 'next/link';

interface AlertTableRow {
  id: number;
  alert_id: number;
  config_id: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  workflow_id?: number;
  workflow_name?: string;
  execution_id?: number;
  execution_status?: string;
  recipient_email: string;
  email_sent: boolean;
  email_sent_at?: string;
  scheduled_for?: string;
  created_at: string;
}

interface AlertsDataTableProps {
  alerts: AlertTableRow[];
  loading?: boolean;
  onRefresh?: () => void;
}

function getSeverityBadgeColor(severity: string) {
  const colors = {
    low: 'bg-gray-200 text-gray-800 border-2 border-black',
    medium: 'bg-yellow-100 text-yellow-800 border-2 border-black',
    high: 'bg-black text-white border-2 border-black',
    critical: 'bg-black text-white font-bold border-2 border-black'
  };
  return colors[severity as keyof typeof colors] || colors.medium;
}

function getExecutionStatusBadge(status?: string) {
  if (!status) return { badge: '-', badgeColor: '' };

  switch (status) {
    case 'completed':
      return { badge: 'COMPLETED', badgeColor: 'bg-white border-2 border-black' };
    case 'running':
      return { badge: 'RUNNING', badgeColor: 'bg-black text-white border-2 border-black animate-pulse' };
    case 'error':
    case 'failed':
      return { badge: 'FAILED', badgeColor: 'bg-black text-white font-bold border-2 border-black' };
    case 'cancelled':
      return { badge: 'CANCELLED', badgeColor: 'bg-gray-200 text-gray-800 border-2 border-black' };
    default:
      return { badge: status.toUpperCase(), badgeColor: 'bg-gray-200 text-gray-800 border-2 border-black' };
  }
}

export const AlertsDataTable = memo(function AlertsDataTable({
  alerts,
  loading = false,
  onRefresh,
}: AlertsDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([
    {
      id: 'created_at',
      desc: true,
    },
  ]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState('');
  const [localSearchValue, setLocalSearchValue] = React.useState('');

  const handleSearch = React.useCallback(() => {
    setGlobalFilter(localSearchValue);
  }, [localSearchValue]);

  const handleClearSearch = React.useCallback(() => {
    setLocalSearchValue('');
    setGlobalFilter('');
  }, []);

  const columns: ColumnDef<AlertTableRow>[] = React.useMemo(
    () => [
      {
        accessorKey: 'severity',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Severity
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => {
          const severity = row.getValue('severity') as string;
          return (
            <span className={cn('px-2 py-1 font-mono text-[10px] uppercase', getSeverityBadgeColor(severity))}>
              {severity}
            </span>
          );
        },
      },
      {
        id: 'workflow_name',
        accessorFn: (row) => row.workflow_name || `Workflow ${row.workflow_id}`,
        header: 'Workflow',
        cell: ({ row }) => {
          return (
            <span className="font-mono text-[10px]">
              {row.original.workflow_name || `Workflow ${row.original.workflow_id}`}
            </span>
          );
        },
      },
      {
        id: 'execution_status',
        accessorKey: 'execution_status',
        header: 'Execution Status',
        cell: ({ row }) => {
          const status = row.original.execution_status;
          const { badge, badgeColor } = getExecutionStatusBadge(status);
          return (
            <span className={cn('font-mono text-[10px] px-1 py-0.5 inline-block', badgeColor)}>
              {badge}
            </span>
          );
        },
      },
      {
        accessorKey: 'recipient_email',
        header: 'Recipient',
        cell: ({ row }) => {
          return (
            <span className="font-mono text-[10px] text-gray-600">
              {row.getValue('recipient_email')}
            </span>
          );
        },
      },
      {
        id: 'status',
        accessorFn: (row) => {
          if (row.email_sent) return 'sent';
          if (row.scheduled_for) return 'queued';
          return 'skipped';
        },
        header: 'Status',
        cell: ({ row }) => {
          const alert = row.original;
          if (alert.email_sent) {
            return (
              <span className="px-2 py-1 bg-white text-black border-2 border-black font-mono text-[10px]">
                SENT
              </span>
            );
          } else if (alert.scheduled_for) {
            return (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 border-2 border-black font-mono text-[10px] inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                QUEUED
              </span>
            );
          } else {
            return (
              <span className="px-2 py-1 bg-gray-200 text-gray-800 border-2 border-black font-mono text-[10px]">
                SKIPPED
              </span>
            );
          }
        },
      },
      {
        id: 'sent_at',
        accessorFn: (row) => row.email_sent_at || row.scheduled_for,
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Sent At
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => {
          const alert = row.original;
          if (alert.email_sent_at) {
            const date = new Date(alert.email_sent_at);
            return <span className="font-mono text-[10px]">{date.toLocaleString()}</span>;
          } else if (alert.scheduled_for) {
            const date = new Date(alert.scheduled_for);
            return <span className="font-mono text-[10px] text-gray-500">Scheduled: {date.toLocaleString()}</span>;
          }
          return <span className="font-mono text-[10px]">-</span>;
        },
      },
      {
        accessorKey: 'created_at',
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
              className="h-auto p-0 font-mono text-white hover:text-black"
            >
              Created
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => {
          const date = new Date(row.getValue('created_at'));
          return <span className="font-mono text-[10px]">{date.toLocaleString()}</span>;
        },
      },
      {
        id: 'execution',
        header: 'Execution',
        cell: ({ row }) => {
          const executionId = row.original.execution_id;
          if (!executionId) return <span className="font-mono text-[10px]">-</span>;
          return (
            <Link
              href={`/dashboard?execution=${executionId}`}
              className="font-mono text-[10px] text-black hover:underline inline-flex items-center gap-1"
            >
              #{executionId}
              <ExternalLink className="w-3 h-3" />
            </Link>
          );
        },
      },
    ],
    []
  );

  const table = useReactTable({
    data: alerts,
    columns,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    onGlobalFilterChange: setGlobalFilter,
    getRowId: (row) => `alert-${row.id}`,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      globalFilter,
    },
  });

  return (
    <div className="w-full">
      <style dangerouslySetInnerHTML={{__html: `
        .alerts-table-wrapper::-webkit-scrollbar {
          height: 14px;
        }
        .alerts-table-wrapper::-webkit-scrollbar-track {
          background: #f1f1f1;
          border-top: 2px solid black;
        }
        .alerts-table-wrapper::-webkit-scrollbar-thumb {
          background: black;
          border: 1px solid black;
        }
        .alerts-table-wrapper {
          overflow-x: scroll !important;
          scrollbar-width: thin;
          scrollbar-color: black #f1f1f1;
        }
      `}} />

      {/* Table Controls */}
      <div className="flex items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-600" />
            <Input
              placeholder="Search alerts... (press Enter)"
              value={localSearchValue}
              onChange={(event) => setLocalSearchValue(event.target.value)}
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
        </div>
      </div>

      {/* Table */}
      <div className="border-2 border-black alerts-table-wrapper">
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
                    <TableCell
                      key={cell.id}
                      className="font-mono py-1 px-2"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-12 text-center">
                  <p className="text-gray-600 font-mono text-xs">No alerts found.</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between py-2">
        <div className="text-xs text-gray-600 font-mono">
          Showing {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
});
