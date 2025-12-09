'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  RefreshCw,
  Database,
  Search,
  Filter,
  X,
  AlertCircle,
  Info,
  AlertTriangle,
  ChevronDown,
  ChevronsUpDown,
  Check,
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface LogEntry {
  Timestamp: string;
  ScopeName: string;
  Body: string;
  SeverityText: string;
  ServiceName: string;
  HostName?: string;
  TraceId?: string;
  SpanId?: string;
  trace_id?: string;
  execution_id?: string;
  workflow_id?: string;
  workflow_name?: string;
  organization_id?: string;
  error_category?: string;
  retry_count?: string;
  execution_time_ms?: string;
  mcp_endpoint?: string;
  LogAttributes?: Record<string, any>;
}

export default function ObservabilityPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter/search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);

  // Logs filter states
  const [logHostFilter, setLogHostFilter] = useState('');
  const [logScopeFilter, setLogScopeFilter] = useState('');
  const [logSeverityFilter, setLogSeverityFilter] = useState('');
  const [traceIdFilter, setTraceIdFilter] = useState('');
  const [executionIdFilter, setExecutionIdFilter] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [errorCategoryFilter, setErrorCategoryFilter] = useState('');
  const [logsToShow, setLogsToShow] = useState(50); // Pagination: show 50 logs at a time
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [availableFilters, setAvailableFilters] = useState<{
    hosts: string[];
    scopes: string[];
    severities: string[];
    workflows: string[];
    organizations: string[];
    errorCategories: string[];
    traceIds: string[];
    executionIds: string[];
  }>({
    hosts: [],
    scopes: [],
    severities: [],
    workflows: [],
    organizations: [],
    errorCategories: [],
    traceIds: [],
    executionIds: [],
  });

  // Popover open states for comboboxes
  const [traceIdOpen, setTraceIdOpen] = useState(false);
  const [executionIdOpen, setExecutionIdOpen] = useState(false);

  // Ref for infinite scroll
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Check if user has @mediar.ai email
  const checkAccess = useCallback(async () => {
    try {
      const response = await fetch(
        '/api/observability/telemetry?metric=overview&hours=1'
      );
      if (response.status === 403) {
        router.push('/unauthorized');
        return false;
      }
      return true;
    } catch (error) {
      console.error('Access check failed:', error);
      return false;
    }
  }, [router]);

  // Fetch logs
  const fetchData = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) setLoading(true);
        setIsRefreshing(true);

        const hasAccess = await checkAccess();
        if (!hasAccess) return;

        // Fetch available filters first if not loaded
        if (availableFilters.hosts.length === 0) {
          const filtersResponse = await fetch(
            `/api/observability/logs?hours=${timeRange}&getFilters=true`
          );
          if (filtersResponse.ok) {
            const filtersData = await filtersResponse.json();
            setAvailableFilters(filtersData.filters);
          }
        }

        // Build query params for logs
        const params = new URLSearchParams({ hours: timeRange });
        if (logHostFilter) params.set('service', logHostFilter);
        if (logScopeFilter) params.set('scope', logScopeFilter);
        if (logSeverityFilter) params.set('severity', logSeverityFilter);
        if (searchQuery) params.set('search', searchQuery);
        if (traceIdFilter) params.set('traceId', traceIdFilter);
        if (executionIdFilter) params.set('executionId', executionIdFilter);
        if (workflowFilter) params.set('workflow', workflowFilter);
        if (organizationFilter) params.set('organization', organizationFilter);
        if (errorCategoryFilter)
          params.set('errorCategory', errorCategoryFilter);

        // Fetch logs from dedicated endpoint
        const response = await fetch(
          `/api/observability/logs?${params.toString()}`
        );
        if (response.ok) {
          const data = await response.json();
          console.log(
            `[Observability] Received ${data.count || 0} logs from API`
          );
          setLogs(data.logs || []);
        } else {
          console.error(
            `[Observability] Failed to fetch logs: ${response.status} ${response.statusText}`
          );
          const errorData = await response.json().catch(() => ({}));
          console.error('[Observability] Error details:', errorData);
          setLogs([]);
        }

        setLastRefresh(new Date());
      } catch (error) {
        console.error('Failed to fetch telemetry data:', error);
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [
      timeRange,
      logHostFilter,
      logScopeFilter,
      logSeverityFilter,
      searchQuery,
      checkAccess,
      availableFilters.hosts.length,
    ]
  );

  // Initial load and refresh on timeRange change
  useEffect(() => {
    if (isLoaded && userId) {
      fetchData();
    }
  }, [isLoaded, userId, timeRange, fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Reset pagination when filters change
  useEffect(() => {
    setLogsToShow(50);
  }, [
    logHostFilter,
    logScopeFilter,
    logSeverityFilter,
    searchQuery,
    traceIdFilter,
    executionIdFilter,
    workflowFilter,
    organizationFilter,
    errorCategoryFilter,
  ]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const target = entries[0];
        if (
          target.isIntersecting &&
          !isLoadingMore &&
          logs.length > logsToShow
        ) {
          setIsLoadingMore(true);
          // Simulate loading delay for smooth UX
          setTimeout(() => {
            setLogsToShow(prev => prev + 50);
            setIsLoadingMore(false);
          }, 300);
        }
      },
      {
        root: null,
        rootMargin: '100px',
        threshold: 0.1,
      }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [isLoadingMore, logs.length, logsToShow]);

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

  const formatTimeCompact = (timestamp: string) => {
    if (!timestamp || timestamp === '') return 'N/A';
    const utcTimestamp = timestamp.includes('Z')
      ? timestamp
      : timestamp.replace(' ', 'T') + 'Z';
    const date = new Date(utcTimestamp);
    if (isNaN(date.getTime())) return 'Invalid';

    // Just show time for today, date + time for older
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const formatLocalTimeOnly = (timestamp: string) => {
    if (!timestamp || timestamp === '') return 'N/A';

    // ClickHouse returns timestamps in UTC without timezone indicator
    // Format: "2025-10-10 23:54:35.400410500"
    // We need to append 'Z' to indicate UTC before parsing
    const utcTimestamp = timestamp.includes('Z')
      ? timestamp
      : timestamp.replace(' ', 'T') + 'Z';
    const date = new Date(utcTimestamp);

    if (isNaN(date.getTime())) return 'Invalid';

    // Use toLocaleString for proper date+time formatting
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'ERROR':
      case 'FATAL':
        return <AlertCircle className="w-3 h-3" />;
      case 'WARN':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <Info className="w-3 h-3" />;
    }
  };

  const getSeverityClass = (severity: string) => {
    switch (severity) {
      case 'ERROR':
      case 'FATAL':
        return 'bg-red-100 text-red-900 border-red-300';
      case 'WARN':
        return 'bg-yellow-100 text-yellow-900 border-yellow-300';
      case 'DEBUG':
        return 'bg-gray-100 text-gray-600 border-gray-300';
      default:
        return 'bg-blue-100 text-blue-900 border-blue-300';
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-6">
            <h1 className="font-mono font-bold text-3xl mb-2 flex items-center gap-2">
              <Database className="w-8 h-8" />
              Logs
            </h1>
            <p className="font-mono text-gray-600 mb-4">
              System logs from all services
            </p>

            <div className="flex items-center gap-3">
              {/* Time Range Selector */}
              <select
                value={timeRange}
                onChange={e => setTimeRange(e.target.value)}
                className="px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              >
                <option value="1">Last 1 Hour</option>
                <option value="6">Last 6 Hours</option>
                <option value="24">Last 24 Hours</option>
                <option value="48">Last 48 Hours</option>
                <option value="168">Last 7 Days</option>
              </select>

              {/* Refresh Button */}
              <Button
                onClick={() => fetchData()}
                className="bg-black text-white hover:bg-gray-800"
                disabled={isRefreshing}
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                REFRESH
              </Button>

              {/* Last Updated */}
              <span className="ml-auto text-xs font-mono text-gray-600">
                Updated: {formatLocalTimeOnly(lastRefresh.toISOString())}
              </span>
            </div>
          </div>

          {/* Search */}
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search logs by message, host, scope, execution ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-10 border-2 border-black font-mono"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="mb-4">
            <div className="flex items-center gap-3 flex-wrap bg-gray-50 p-4 border-2 border-black">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                <span className="font-mono font-bold text-xs uppercase">
                  FILTERS
                </span>
              </div>

              {/* Hostname Filter */}
              <select
                value={logHostFilter}
                onChange={e => setLogHostFilter(e.target.value)}
                className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
              >
                <option value="">All Hosts</option>
                {availableFilters.hosts.map(host => (
                  <option key={host} value={host}>
                    {host}
                  </option>
                ))}
              </select>

              {/* Severity Filter */}
              <select
                value={logSeverityFilter}
                onChange={e => setLogSeverityFilter(e.target.value)}
                className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
              >
                <option value="">All Severities</option>
                {availableFilters.severities.map(severity => (
                  <option key={severity} value={severity}>
                    {severity}
                  </option>
                ))}
              </select>

              {/* Scope Filter */}
              <select
                value={logScopeFilter}
                onChange={e => setLogScopeFilter(e.target.value)}
                className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black max-w-xs bg-white"
              >
                <option value="">All Scopes</option>
                {availableFilters.scopes.map(scope => (
                  <option key={scope} value={scope} className="truncate">
                    {scope}
                  </option>
                ))}
              </select>

              {/* Trace ID Combobox */}
              <Popover open={traceIdOpen} onOpenChange={setTraceIdOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={traceIdOpen}
                    className="w-44 justify-between px-3 py-1.5 border-2 border-black font-mono text-xs h-auto"
                  >
                    {traceIdFilter
                      ? traceIdFilter.slice(0, 12) + '...'
                      : 'Trace ID'}
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search or paste trace ID..."
                      value={traceIdFilter}
                      onValueChange={setTraceIdFilter}
                      className="font-mono text-xs"
                    />
                    <CommandList>
                      <CommandEmpty>
                        {traceIdFilter
                          ? 'Press Enter to use this ID'
                          : 'No trace IDs found'}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableFilters.traceIds.slice(0, 20).map(id => (
                          <CommandItem
                            key={id}
                            value={id}
                            onSelect={() => {
                              setTraceIdFilter(id);
                              setTraceIdOpen(false);
                            }}
                            className="font-mono text-xs"
                          >
                            <Check
                              className={cn(
                                'mr-2 h-3 w-3',
                                traceIdFilter === id
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                            {id.slice(0, 20)}...
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Execution ID Combobox */}
              <Popover open={executionIdOpen} onOpenChange={setExecutionIdOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={executionIdOpen}
                    className="w-36 justify-between px-3 py-1.5 border-2 border-black font-mono text-xs h-auto"
                  >
                    {executionIdFilter || 'Execution ID'}
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Search execution ID..."
                      value={executionIdFilter}
                      onValueChange={setExecutionIdFilter}
                      className="font-mono text-xs"
                    />
                    <CommandList>
                      <CommandEmpty>
                        {executionIdFilter
                          ? 'Press Enter to use this ID'
                          : 'No execution IDs found'}
                      </CommandEmpty>
                      <CommandGroup>
                        {availableFilters.executionIds.slice(0, 20).map(id => (
                          <CommandItem
                            key={id}
                            value={id}
                            onSelect={() => {
                              setExecutionIdFilter(id);
                              setExecutionIdOpen(false);
                            }}
                            className="font-mono text-xs"
                          >
                            <Check
                              className={cn(
                                'mr-2 h-3 w-3',
                                executionIdFilter === id
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                            {id}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Workflow Filter */}
              <select
                value={workflowFilter}
                onChange={e => setWorkflowFilter(e.target.value)}
                className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
              >
                <option value="">All Workflows</option>
                {availableFilters.workflows.map(workflow => (
                  <option key={workflow} value={workflow}>
                    {workflow}
                  </option>
                ))}
              </select>

              {/* Organization Filter */}
              <select
                value={organizationFilter}
                onChange={e => setOrganizationFilter(e.target.value)}
                className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
              >
                <option value="">All Organizations</option>
                {availableFilters.organizations.map(org => (
                  <option key={org} value={org}>
                    {org}
                  </option>
                ))}
              </select>

              {/* Error Category Filter */}
              <select
                value={errorCategoryFilter}
                onChange={e => setErrorCategoryFilter(e.target.value)}
                className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
              >
                <option value="">All Error Types</option>
                {availableFilters.errorCategories.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              {/* Clear Filters */}
              {(logHostFilter ||
                logSeverityFilter ||
                logScopeFilter ||
                searchQuery ||
                traceIdFilter ||
                executionIdFilter ||
                workflowFilter ||
                organizationFilter ||
                errorCategoryFilter) && (
                <button
                  onClick={() => {
                    setLogHostFilter('');
                    setLogSeverityFilter('');
                    setLogScopeFilter('');
                    setSearchQuery('');
                    setTraceIdFilter('');
                    setExecutionIdFilter('');
                    setWorkflowFilter('');
                    setOrganizationFilter('');
                    setErrorCategoryFilter('');
                  }}
                  className="px-3 py-1.5 border-2 border-black bg-white text-black hover:bg-black hover:text-white font-mono text-xs flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  CLEAR ALL
                </button>
              )}
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="border-2 border-black p-3 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-4 bg-gray-200 rounded w-20"></div>
                    <div className="h-4 bg-gray-200 rounded w-16"></div>
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                    <div className="h-4 bg-gray-200 rounded flex-1"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Ungrouped View */}
              <div className="space-y-1">
                {logs.length === 0 ? (
                  <div className="border-2 border-black p-8 text-center text-gray-600 font-mono">
                    No logs found{' '}
                    {logHostFilter ||
                    logSeverityFilter ||
                    logScopeFilter ||
                    searchQuery
                      ? 'matching filters'
                      : 'in selected time range'}
                  </div>
                ) : (
                  logs.slice(0, logsToShow).map((log, i) => {
                    const isSelected = selectedLog === log;
                    const severity = log.SeverityText || 'INFO';

                    return (
                      <div key={i}>
                        {/* Compact Log Line */}
                        <button
                          onClick={() =>
                            setSelectedLog(isSelected ? null : log)
                          }
                          className="w-full border border-gray-300 hover:border-black hover:bg-gray-50 p-2 text-left transition-colors"
                        >
                          <div className="flex items-center gap-3 font-mono text-xs">
                            {/* Time */}
                            <span className="text-gray-500 w-20 flex-shrink-0">
                              {formatTimeCompact(log.Timestamp)}
                            </span>

                            {/* Severity Badge */}
                            <span
                              className={`px-2 py-0.5 border rounded-sm flex items-center gap-1 ${getSeverityClass(severity)} flex-shrink-0`}
                            >
                              {getSeverityIcon(severity)}
                              {severity}
                            </span>

                            {/* Host */}
                            <span
                              className="text-gray-600 w-32 truncate flex-shrink-0"
                              title={log.HostName || '-'}
                            >
                              {log.HostName || '-'}
                            </span>

                            {/* Message (truncated) */}
                            <span className="flex-1 truncate text-black">
                              {log.Body}
                            </span>

                            {/* Expand Icon */}
                            <ChevronDown
                              className={`w-4 h-4 flex-shrink-0 transition-transform ${isSelected ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>

                        {/* Expanded Details */}
                        {isSelected && (
                          <div className="border-2 border-black bg-gray-50 p-4 space-y-3 mb-1 font-mono text-xs">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="font-bold uppercase text-gray-600">
                                  Timestamp:
                                </span>
                                <div className="mt-1">{log.Timestamp}</div>
                              </div>
                              <div>
                                <span className="font-bold uppercase text-gray-600">
                                  Severity:
                                </span>
                                <div className="mt-1">{severity}</div>
                              </div>
                              <div>
                                <span className="font-bold uppercase text-gray-600">
                                  Host:
                                </span>
                                <div className="mt-1">
                                  {log.HostName || 'N/A'}
                                </div>
                              </div>
                              <div>
                                <span className="font-bold uppercase text-gray-600">
                                  Service:
                                </span>
                                <div className="mt-1">
                                  {log.ServiceName || 'N/A'}
                                </div>
                              </div>
                            </div>

                            {/* Workflow Context - only show if present */}
                            {(log.trace_id ||
                              log.execution_id ||
                              log.workflow_name ||
                              log.organization_id) && (
                              <div className="border-t-2 border-gray-300 pt-3 mt-3">
                                <span className="font-bold uppercase text-gray-600 mb-2 block">
                                  Workflow Context:
                                </span>
                                <div className="grid grid-cols-2 gap-4">
                                  {log.trace_id && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Trace ID:
                                      </span>
                                      <button
                                        onClick={() => {
                                          setTraceIdFilter(log.trace_id || '');
                                          setSelectedLog(null);
                                        }}
                                        className="mt-1 p-2 bg-black text-white border-2 border-black break-all w-full text-left hover:bg-gray-800 flex items-center gap-2"
                                        title="Filter logs by this trace ID"
                                      >
                                        <Filter className="w-3 h-3 flex-shrink-0" />
                                        <span className="truncate">
                                          {log.trace_id}
                                        </span>
                                      </button>
                                    </div>
                                  )}
                                  {log.execution_id && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Execution ID:
                                      </span>
                                      <button
                                        onClick={() => {
                                          setExecutionIdFilter(
                                            log.execution_id || ''
                                          );
                                          setSelectedLog(null);
                                        }}
                                        className="mt-1 p-2 bg-black text-white border-2 border-black break-all w-full text-left hover:bg-gray-800 flex items-center gap-2"
                                        title="Filter logs by this execution ID"
                                      >
                                        <Filter className="w-3 h-3 flex-shrink-0" />
                                        <span>{log.execution_id}</span>
                                      </button>
                                    </div>
                                  )}
                                  {log.workflow_id && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Workflow ID:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.workflow_id}
                                      </div>
                                    </div>
                                  )}
                                  {log.workflow_name && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Workflow Name:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.workflow_name}
                                      </div>
                                    </div>
                                  )}
                                  {log.organization_id && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Organization:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.organization_id}
                                      </div>
                                    </div>
                                  )}
                                  {log.error_category && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Error Category:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.error_category}
                                      </div>
                                    </div>
                                  )}
                                  {log.retry_count && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Retry Count:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.retry_count}
                                      </div>
                                    </div>
                                  )}
                                  {log.execution_time_ms && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        Execution Time:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.execution_time_ms}ms
                                      </div>
                                    </div>
                                  )}
                                  {log.mcp_endpoint && (
                                    <div>
                                      <span className="font-bold uppercase text-gray-500 text-xxs">
                                        MCP Endpoint:
                                      </span>
                                      <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                        {log.mcp_endpoint}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            <div>
                              <span className="font-bold uppercase text-gray-600">
                                Scope:
                              </span>
                              <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                {log.ScopeName}
                              </div>
                            </div>

                            <div>
                              <span className="font-bold uppercase text-gray-600">
                                Message:
                              </span>
                              <div className="mt-1 p-2 bg-white border border-gray-300 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                                {log.Body}
                              </div>
                            </div>

                            {log.TraceId && (
                              <div>
                                <span className="font-bold uppercase text-gray-600">
                                  Trace ID:
                                </span>
                                <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                  {log.TraceId}
                                </div>
                              </div>
                            )}

                            {log.SpanId && (
                              <div>
                                <span className="font-bold uppercase text-gray-600">
                                  Span ID:
                                </span>
                                <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                  {log.SpanId}
                                </div>
                              </div>
                            )}

                            {/* Show all LogAttributes */}
                            {log.LogAttributes &&
                              Object.keys(log.LogAttributes).length > 0 && (
                                <div className="border-t-2 border-gray-300 pt-3 mt-3">
                                  <span className="font-bold uppercase text-gray-600 mb-2 block">
                                    All Attributes:
                                  </span>
                                  <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(log.LogAttributes).map(
                                      ([key, value]) => (
                                        <div key={key} className="text-xs">
                                          <span className="font-bold text-gray-500">
                                            {key}:
                                          </span>
                                          <span className="ml-1 text-gray-700 break-all">
                                            {String(value)}
                                          </span>
                                        </div>
                                      )
                                    )}
                                  </div>
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Infinite Scroll Loading Sentinel */}
              {logs.length > logsToShow && (
                <div ref={loadMoreRef} className="flex justify-center py-6">
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 font-mono text-sm text-gray-600">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black" />
                      Loading more logs...
                    </div>
                  ) : (
                    <div className="h-1" />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
