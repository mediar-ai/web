'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  Server,
  Database,
  Search,
  ChevronDown,
  ChevronRight,
  Filter,
  X
} from 'lucide-react';

interface ServiceHealth {
  ServiceName: string;
  total_spans: number;
  errors: number;
  error_rate: number;
  last_seen: string;
  avg_duration_seconds: number;
}

interface ToolUsage {
  tool: string;
  executions: number;
  avg_seconds: number;
  max_seconds: number;
  failures: number;
  failure_rate: number;
}

interface RecentExecution {
  Timestamp: string;
  TraceId: string;
  ServiceName: string;
  SpanName: string;
  duration_seconds: number;
  StatusCode: string;
  StatusMessage?: string;
  SpanAttributes: Record<string, any>;
  workflow_name?: string;
  total_steps?: string;
  host_name?: string;
}

interface RecentError {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  ServiceName: string;
  operation: string;
  duration_seconds: number;
  SpanAttributes: Record<string, any>;
  error_message?: string;
  error_type?: string;
  workflow_name?: string;
  workflow_step?: string;
  total_steps?: string;
  tool_name?: string;
  host_name?: string;
  StatusMessage?: string;
}

interface LogEntry {
  Timestamp: string;
  ScopeName: string;
  Body: string;
  SeverityText: string;
  ServiceName: string;
  HostName?: string;
  TraceId?: string;
  SpanId?: string;
}

export default function ObservabilityPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24');
  const [activeTab, setActiveTab] = useState<'overview' | 'executions' | 'tools' | 'errors' | 'logs'>('overview');

  // Data states
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth[]>([]);
  const [toolUsage, setToolUsage] = useState<ToolUsage[]>([]);
  const [recentExecutions, setRecentExecutions] = useState<RecentExecution[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter/search states
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'error' | 'success'>('all');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Logs filter states
  const [logHostFilter, setLogHostFilter] = useState('');
  const [logScopeFilter, setLogScopeFilter] = useState('');
  const [logSeverityFilter, setLogSeverityFilter] = useState('');
  const [availableFilters, setAvailableFilters] = useState<{
    hosts: string[];
    scopes: string[];
    severities: string[];
  }>({ hosts: [], scopes: [], severities: [] });

  // Check if user has @mediar.ai email
  const checkAccess = useCallback(async () => {
    try {
      const response = await fetch('/api/observability/telemetry?metric=overview&hours=1');
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

  // Fetch data based on active tab
  const fetchData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setIsRefreshing(true);

      const hasAccess = await checkAccess();
      if (!hasAccess) return;

      const metric = activeTab;
      if (activeTab === 'overview') {
        // Fetch both overview and tools for the overview tab
        const [overviewResponse, toolsResponse] = await Promise.all([
          fetch(`/api/observability/telemetry?metric=overview&hours=${timeRange}`),
          fetch(`/api/observability/telemetry?metric=tools&hours=${timeRange}`)
        ]);

        if (overviewResponse.ok && toolsResponse.ok) {
          const overviewData = await overviewResponse.json();
          const toolsData = await toolsResponse.json();
          console.log(`[Observability] Overview: ${overviewData.data?.length || 0} services`);
          console.log(`[Observability] Tools: ${toolsData.data?.length || 0} tools`);
          setServiceHealth(overviewData.data || []);
          setToolUsage(toolsData.data || []);
        } else {
          console.error(`[Observability] Failed to fetch overview/tools data`);
          if (!overviewResponse.ok) {
            console.error(`Overview error: ${overviewResponse.status}`);
          }
          if (!toolsResponse.ok) {
            console.error(`Tools error: ${toolsResponse.status}`);
          }
          setServiceHealth([]);
          setToolUsage([]);
        }
      } else if (activeTab === 'logs') {
        // Fetch available filters first if not loaded
        if (availableFilters.hosts.length === 0) {
          const filtersResponse = await fetch(`/api/observability/logs?hours=${timeRange}&getFilters=true`);
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

        // Fetch logs from dedicated endpoint
        const response = await fetch(`/api/observability/logs?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          console.log(`[Observability] Received ${data.count || 0} logs from API`);
          setLogs(data.logs || []);
        } else {
          console.error(`[Observability] Failed to fetch logs: ${response.status} ${response.statusText}`);
          const errorData = await response.json().catch(() => ({}));
          console.error('[Observability] Error details:', errorData);
          setLogs([]);
        }
      } else {
        const response = await fetch(`/api/observability/telemetry?metric=${metric}&hours=${timeRange}`);
        if (response.ok) {
          const data = await response.json();
          console.log(`[Observability] ${metric}: ${data.data?.length || 0} records`);

          switch (activeTab) {
            case 'executions':
              setRecentExecutions(data.data || []);
              break;
            case 'tools':
              setToolUsage(data.data || []);
              break;
            case 'errors':
              setRecentErrors(data.data || []);
              break;
          }
        } else {
          console.error(`[Observability] Failed to fetch ${metric}: ${response.status}`);
          const errorData = await response.json().catch(() => ({}));
          console.error('[Observability] Error details:', errorData);

          switch (activeTab) {
            case 'executions':
              setRecentExecutions([]);
              break;
            case 'tools':
              setToolUsage([]);
              break;
            case 'errors':
              setRecentErrors([]);
              break;
          }
        }
      }

      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [activeTab, timeRange, logHostFilter, logScopeFilter, logSeverityFilter, searchQuery, checkAccess, availableFilters.hosts.length]);

  // Initial load and refresh on tab/timeRange change
  useEffect(() => {
    if (isLoaded && userId) {
      fetchData();
    }
  }, [isLoaded, userId, activeTab, timeRange, fetchData]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // Filter executions - must be before early return
  const filteredExecutions = useMemo(() => {
    return recentExecutions.filter(exec => {
      const matchesSearch = searchQuery === '' ||
        exec.TraceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exec.ServiceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exec.SpanName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exec.workflow_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exec.host_name?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'error' && exec.StatusCode === 'STATUS_CODE_ERROR') ||
        (statusFilter === 'success' && (exec.StatusCode === 'STATUS_CODE_OK' || exec.StatusCode === 'STATUS_CODE_UNSET'));

      return matchesSearch && matchesStatus;
    });
  }, [recentExecutions, searchQuery, statusFilter]);

  // Filter errors - must be before early return
  const filteredErrors = useMemo(() => {
    return recentErrors.filter(error => {
      const matchesSearch = searchQuery === '' ||
        error.TraceId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.ServiceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.operation.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.tool_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.error_message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.error_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.workflow_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        error.host_name?.toLowerCase().includes(searchQuery.toLowerCase());

      return matchesSearch;
    });
  }, [recentErrors, searchQuery]);

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

  const formatDuration = (seconds: number) => {
    if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
    if (seconds < 60) return `${seconds.toFixed(2)}s`;
    return `${(seconds / 60).toFixed(1)}m`;
  };

  const formatLocalTime = (timestamp: string) => {
    if (!timestamp || timestamp === '') return 'N/A';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Invalid Date';
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const formatLocalTimeOnly = (timestamp: string) => {
    if (!timestamp || timestamp === '') return 'N/A';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'Invalid';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const getStatusColor = (statusCode: string) => {
    return statusCode === 'STATUS_CODE_ERROR' ? 'bg-black text-white' : 'bg-white text-black border-2 border-black';
  };

  const getHealthColor = (errorRate: number) => {
    if (errorRate === 0) return 'bg-white text-black border-2 border-black';
    if (errorRate < 5) return 'bg-gray-200 text-gray-800';
    return 'bg-black text-white';
  };

  const toggleRow = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="w-8 h-8" />
            <h1 className="text-3xl font-mono font-bold">OBSERVABILITY</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Time Range Selector */}
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
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
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              REFRESH
            </Button>

            {/* Last Updated */}
            <span className="text-xs font-mono text-gray-600">
              Updated: {formatLocalTimeOnly(lastRefresh.toISOString())}
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-0 border-2 border-black w-fit">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-6 py-2 font-mono font-bold ${
              activeTab === 'overview' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            OVERVIEW
          </button>
          <button
            onClick={() => setActiveTab('executions')}
            className={`px-6 py-2 font-mono font-bold border-l-2 border-black ${
              activeTab === 'executions' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            EXECUTIONS
          </button>
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-6 py-2 font-mono font-bold border-l-2 border-black ${
              activeTab === 'tools' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            TOOLS
          </button>
          <button
            onClick={() => setActiveTab('errors')}
            className={`px-6 py-2 font-mono font-bold border-l-2 border-black ${
              activeTab === 'errors' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            ERRORS
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`px-6 py-2 font-mono font-bold border-l-2 border-black ${
              activeTab === 'logs' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
            }`}
          >
            LOGS
          </button>
        </div>

        {/* Search and Filters */}
        {(activeTab === 'executions' || activeTab === 'errors' || activeTab === 'logs') && (
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder={
                  activeTab === 'logs'
                    ? 'Search logs by scope, service, message...'
                    : 'Search by trace ID, service, workflow...'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 border-2 border-black font-mono"
              />
            </div>
            {activeTab === 'executions' && (
              <div className="flex gap-2">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-4 py-2 font-mono text-sm border-2 border-black ${
                    statusFilter === 'all' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
                  }`}
                >
                  ALL
                </button>
                <button
                  onClick={() => setStatusFilter('success')}
                  className={`px-4 py-2 font-mono text-sm border-2 border-black ${
                    statusFilter === 'success' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
                  }`}
                >
                  SUCCESS
                </button>
                <button
                  onClick={() => setStatusFilter('error')}
                  className={`px-4 py-2 font-mono text-sm border-2 border-black ${
                    statusFilter === 'error' ? 'bg-black text-white' : 'bg-white text-black hover:bg-gray-100'
                  }`}
                >
                  ERRORS
                </button>
              </div>
            )}
          </div>
        )}

        {/* Content based on active tab */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Service Health Grid */}
                <div>
                  <h2 className="text-lg font-mono font-bold mb-4">SERVICE HEALTH</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {serviceHealth.map((service) => (
                      <div key={service.ServiceName} className="border-2 border-black p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Server className="w-5 h-5" />
                            <span className="font-mono font-bold">{service.ServiceName}</span>
                          </div>
                          <span className={`px-2 py-1 text-xs font-mono ${getHealthColor(service.error_rate)}`}>
                            {service.error_rate.toFixed(1)}% ERROR
                          </span>
                        </div>
                        <div className="space-y-1 text-sm font-mono">
                          <div className="flex justify-between">
                            <span className="text-gray-600">Total Spans:</span>
                            <span>{service.total_spans.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Avg Duration:</span>
                            <span>{formatDuration(service.avg_duration_seconds)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600">Last Seen:</span>
                            <span>{formatLocalTimeOnly(service.last_seen)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Top Tools */}
                <div>
                  <h2 className="text-lg font-mono font-bold mb-4">TOP TOOLS BY USAGE</h2>
                  <div className="border-2 border-black">
                    <Table>
                      <TableHeader className="bg-black text-white">
                        <TableRow>
                          <TableHead className="text-white font-mono">Tool</TableHead>
                          <TableHead className="text-white font-mono">Executions</TableHead>
                          <TableHead className="text-white font-mono">Avg Duration</TableHead>
                          <TableHead className="text-white font-mono">Failure Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {toolUsage.slice(0, 10).map((tool) => (
                          <TableRow key={tool.tool} className="hover:bg-gray-50">
                            <TableCell className="font-mono text-sm">{tool.tool}</TableCell>
                            <TableCell className="font-mono text-sm">{tool.executions.toLocaleString()}</TableCell>
                            <TableCell className="font-mono text-sm">{formatDuration(tool.avg_seconds)}</TableCell>
                            <TableCell>
                              <span className={`font-mono text-xs px-2 py-1 ${
                                tool.failure_rate === 0 ? 'bg-white border border-gray-300' :
                                tool.failure_rate < 5 ? 'bg-gray-200' : 'bg-black text-white'
                              }`}>
                                {tool.failure_rate.toFixed(1)}%
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'executions' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-mono font-bold">RECENT EXECUTIONS</h2>
                  <span className="text-sm font-mono text-gray-600">
                    Showing {filteredExecutions.length} of {recentExecutions.length}
                  </span>
                </div>
                <div className="border-2 border-black overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-black text-white">
                      <TableRow>
                        <TableHead className="text-white font-mono w-8"></TableHead>
                        <TableHead className="text-white font-mono">Timestamp</TableHead>
                        <TableHead className="text-white font-mono">Workflow</TableHead>
                        <TableHead className="text-white font-mono">Host</TableHead>
                        <TableHead className="text-white font-mono">Duration</TableHead>
                        <TableHead className="text-white font-mono">Status</TableHead>
                        <TableHead className="text-white font-mono">Trace ID</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExecutions.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-gray-600 font-mono">
                            No executions found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredExecutions.map((execution) => (
                          <>
                            <TableRow key={execution.TraceId} className="hover:bg-gray-50">
                              <TableCell>
                                <button
                                  onClick={() => toggleRow(execution.TraceId)}
                                  className="p-1 hover:bg-gray-200"
                                >
                                  {expandedRows.has(execution.TraceId) ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {formatLocalTime(execution.Timestamp)}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {execution.workflow_name || '-'}
                                {execution.total_steps && <span className="text-gray-500 ml-1">({execution.total_steps} steps)</span>}
                              </TableCell>
                              <TableCell className="font-mono text-sm">{execution.host_name || '-'}</TableCell>
                              <TableCell className="font-mono text-sm">{formatDuration(execution.duration_seconds)}</TableCell>
                              <TableCell>
                                <span className={`font-mono text-xs px-2 py-1 ${getStatusColor(execution.StatusCode)}`}>
                                  {execution.StatusCode === 'STATUS_CODE_OK' || execution.StatusCode === 'STATUS_CODE_UNSET' ? 'SUCCESS' : 'ERROR'}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-gray-600">
                                {execution.TraceId.substring(0, 16)}...
                              </TableCell>
                            </TableRow>
                            {expandedRows.has(execution.TraceId) && (
                              <TableRow>
                                <TableCell colSpan={7} className="bg-gray-50 p-4">
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-2 gap-4">
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Full Trace ID:</span> {execution.TraceId}
                                      </div>
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Service:</span> {execution.ServiceName}
                                      </div>
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Duration:</span> {formatDuration(execution.duration_seconds)}
                                      </div>
                                      {execution.host_name && (
                                        <div className="font-mono text-xs">
                                          <span className="font-bold">Host:</span> {execution.host_name}
                                        </div>
                                      )}
                                    </div>
                                    {execution.StatusMessage && (
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Status Message:</span>
                                        <div className="mt-1 p-2 bg-white border border-gray-300">
                                          {execution.StatusMessage}
                                        </div>
                                      </div>
                                    )}
                                    {execution.SpanAttributes && Object.keys(execution.SpanAttributes).length > 0 && (
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Full Attributes:</span>
                                        <pre className="mt-1 p-2 bg-white border border-gray-300 overflow-auto max-h-60">
                                          {JSON.stringify(execution.SpanAttributes, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <div>
                <h2 className="text-lg font-mono font-bold mb-4">TOOL USAGE STATISTICS</h2>
                <div className="border-2 border-black overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-black text-white">
                      <TableRow>
                        <TableHead className="text-white font-mono">Tool Name</TableHead>
                        <TableHead className="text-white font-mono">Executions</TableHead>
                        <TableHead className="text-white font-mono">Avg Duration</TableHead>
                        <TableHead className="text-white font-mono">Max Duration</TableHead>
                        <TableHead className="text-white font-mono">Failures</TableHead>
                        <TableHead className="text-white font-mono">Failure Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {toolUsage.map((tool) => (
                        <TableRow key={tool.tool} className="hover:bg-gray-50">
                          <TableCell className="font-mono text-sm font-bold">{tool.tool}</TableCell>
                          <TableCell className="font-mono text-sm">{tool.executions.toLocaleString()}</TableCell>
                          <TableCell className="font-mono text-sm">{formatDuration(tool.avg_seconds)}</TableCell>
                          <TableCell className="font-mono text-sm">{formatDuration(tool.max_seconds)}</TableCell>
                          <TableCell className="font-mono text-sm">{tool.failures.toLocaleString()}</TableCell>
                          <TableCell>
                            <span className={`font-mono text-xs px-2 py-1 ${
                              tool.failure_rate === 0 ? 'bg-white border border-gray-300' :
                              tool.failure_rate < 5 ? 'bg-gray-200' : 'bg-black text-white'
                            }`}>
                              {tool.failure_rate.toFixed(2)}%
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {activeTab === 'errors' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-mono font-bold">RECENT ERRORS</h2>
                  <span className="text-sm font-mono text-gray-600">
                    Showing {filteredErrors.length} of {recentErrors.length}
                  </span>
                </div>
                <div className="border-2 border-black overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-black text-white">
                      <TableRow>
                        <TableHead className="text-white font-mono w-8"></TableHead>
                        <TableHead className="text-white font-mono">Timestamp</TableHead>
                        <TableHead className="text-white font-mono">Tool/Step</TableHead>
                        <TableHead className="text-white font-mono">Error Type</TableHead>
                        <TableHead className="text-white font-mono">Step</TableHead>
                        <TableHead className="text-white font-mono">Host</TableHead>
                        <TableHead className="text-white font-mono">Error Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredErrors.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-gray-600 font-mono">
                            No errors in the selected time range
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredErrors.map((error) => (
                          <>
                            <TableRow key={`${error.TraceId}-${error.SpanId}`} className="hover:bg-gray-50">
                              <TableCell>
                                <button
                                  onClick={() => toggleRow(`${error.TraceId}-${error.SpanId}`)}
                                  className="p-1 hover:bg-gray-200"
                                >
                                  {expandedRows.has(`${error.TraceId}-${error.SpanId}`) ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {formatLocalTime(error.Timestamp)}
                              </TableCell>
                              <TableCell className="font-mono text-sm font-bold">{error.tool_name || error.operation}</TableCell>
                              <TableCell className="font-mono text-sm">
                                <span className={`px-2 py-0.5 text-xs ${
                                  error.error_type === 'element_not_found' ? 'bg-gray-200' : 'bg-gray-100'
                                }`}>
                                  {error.error_type || 'unknown'}
                                </span>
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {error.workflow_step && error.total_steps ?
                                  `${error.workflow_step}/${error.total_steps}` : '-'}
                              </TableCell>
                              <TableCell className="font-mono text-sm">{error.host_name || '-'}</TableCell>
                              <TableCell className="font-mono text-sm max-w-xs truncate" title={error.error_message}>
                                {error.error_message || error.StatusMessage || '-'}
                              </TableCell>
                            </TableRow>
                            {expandedRows.has(`${error.TraceId}-${error.SpanId}`) && (
                              <TableRow>
                                <TableCell colSpan={7} className="bg-gray-50 p-4">
                                  <div className="space-y-3">
                                    <div className="grid grid-cols-3 gap-4">
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Trace ID:</span> {error.TraceId}
                                      </div>
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Span ID:</span> {error.SpanId}
                                      </div>
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Duration:</span> {formatDuration(error.duration_seconds)}
                                      </div>
                                      {error.host_name && (
                                        <div className="font-mono text-xs">
                                          <span className="font-bold">Host:</span> {error.host_name}
                                        </div>
                                      )}
                                      {error.workflow_name && (
                                        <div className="font-mono text-xs">
                                          <span className="font-bold">Workflow:</span> {error.workflow_name}
                                        </div>
                                      )}
                                      {error.error_type && (
                                        <div className="font-mono text-xs">
                                          <span className="font-bold">Error Type:</span> {error.error_type}
                                        </div>
                                      )}
                                    </div>
                                    {error.error_message && (
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Error Message:</span>
                                        <div className="mt-1 p-2 bg-white border border-gray-300 max-h-40 overflow-auto">
                                          {error.error_message}
                                        </div>
                                      </div>
                                    )}
                                    {error.StatusMessage && error.StatusMessage !== error.error_message && (
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Status Message:</span>
                                        <div className="mt-1 p-2 bg-white border border-gray-300 max-h-40 overflow-auto">
                                          {error.StatusMessage}
                                        </div>
                                      </div>
                                    )}
                                    {error.SpanAttributes && Object.keys(error.SpanAttributes).length > 0 && (
                                      <div className="font-mono text-xs">
                                        <span className="font-bold">Full Attributes:</span>
                                        <pre className="mt-1 p-2 bg-white border border-gray-300 overflow-auto max-h-60">
                                          {JSON.stringify(error.SpanAttributes, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="space-y-4">
                {/* Filters Row */}
                <div className="flex items-center gap-3 flex-wrap bg-gray-50 p-4 border-2 border-black">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    <span className="font-mono font-bold text-xs uppercase">FILTERS</span>
                  </div>

                  {/* Hostname Filter */}
                  <select
                    value={logHostFilter}
                    onChange={(e) => setLogHostFilter(e.target.value)}
                    className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
                  >
                    <option value="">All Hosts</option>
                    {availableFilters.hosts.map(host => (
                      <option key={host} value={host}>{host}</option>
                    ))}
                  </select>

                  {/* Severity Filter */}
                  <select
                    value={logSeverityFilter}
                    onChange={(e) => setLogSeverityFilter(e.target.value)}
                    className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black bg-white"
                  >
                    <option value="">All Severities</option>
                    {availableFilters.severities.map(severity => (
                      <option key={severity} value={severity}>{severity}</option>
                    ))}
                  </select>

                  {/* Scope Filter */}
                  <select
                    value={logScopeFilter}
                    onChange={(e) => setLogScopeFilter(e.target.value)}
                    className="px-3 py-1.5 border-2 border-black font-mono text-xs focus:outline-none focus:ring-2 focus:ring-black max-w-xs bg-white"
                  >
                    <option value="">All Scopes</option>
                    {availableFilters.scopes.map(scope => (
                      <option key={scope} value={scope} className="truncate">{scope}</option>
                    ))}
                  </select>

                  {/* Clear Filters */}
                  {(logHostFilter || logSeverityFilter || logScopeFilter || searchQuery) && (
                    <button
                      onClick={() => {
                        setLogHostFilter('');
                        setLogSeverityFilter('');
                        setLogScopeFilter('');
                        setSearchQuery('');
                      }}
                      className="px-3 py-1.5 border-2 border-black bg-white text-black hover:bg-black hover:text-white font-mono text-xs flex items-center gap-1"
                    >
                      <X className="w-3 h-3" />
                      CLEAR ALL
                    </button>
                  )}

                  {/* Log Count */}
                  <div className="ml-auto text-sm font-mono font-bold">
                    {logs.length} logs
                  </div>
                </div>

                {/* Active Filters Display */}
                {(logHostFilter || logSeverityFilter || logScopeFilter || searchQuery) && (
                  <div className="flex items-center gap-2 flex-wrap px-2">
                    <span className="text-xs font-mono text-gray-600 uppercase font-bold">Active Filters:</span>
                    {logHostFilter && (
                      <span className="px-2 py-1 bg-black text-white font-mono text-xs flex items-center gap-1">
                        Host: {logHostFilter}
                        <X className="w-3 h-3 cursor-pointer hover:text-gray-300" onClick={() => setLogHostFilter('')} />
                      </span>
                    )}
                    {logSeverityFilter && (
                      <span className="px-2 py-1 bg-black text-white font-mono text-xs flex items-center gap-1">
                        Severity: {logSeverityFilter}
                        <X className="w-3 h-3 cursor-pointer hover:text-gray-300" onClick={() => setLogSeverityFilter('')} />
                      </span>
                    )}
                    {logScopeFilter && (
                      <span className="px-2 py-1 bg-black text-white font-mono text-xs flex items-center gap-1">
                        Scope: {logScopeFilter}
                        <X className="w-3 h-3 cursor-pointer hover:text-gray-300" onClick={() => setLogScopeFilter('')} />
                      </span>
                    )}
                    {searchQuery && (
                      <span className="px-2 py-1 bg-black text-white font-mono text-xs flex items-center gap-1">
                        Search: {searchQuery}
                        <X className="w-3 h-3 cursor-pointer hover:text-gray-300" onClick={() => setSearchQuery('')} />
                      </span>
                    )}
                  </div>
                )}

                {/* Logs Table */}
                <div className="border-2 border-black overflow-auto" style={{ maxHeight: '70vh' }}>
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-black text-white sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-bold">TIME</th>
                        <th className="text-left p-2 font-bold">LEVEL</th>
                        <th className="text-left p-2 font-bold">HOST</th>
                        <th className="text-left p-2 font-bold">SCOPE</th>
                        <th className="text-left p-2 font-bold">MESSAGE</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-gray-600">
                            No logs found {logHostFilter || logSeverityFilter || logScopeFilter || searchQuery ? 'matching filters' : 'in selected time range'}
                          </td>
                        </tr>
                      ) : (
                        logs.map((log, i) => {
                          const severityClass =
                            log.SeverityText === 'ERROR' || log.SeverityText === 'FATAL' ? 'bg-red-50 border-l-4 border-l-red-500' :
                            log.SeverityText === 'WARN' ? 'bg-yellow-50 border-l-4 border-l-yellow-500' :
                            log.SeverityText === 'DEBUG' ? 'bg-gray-50' :
                            '';

                          const severityText =
                            log.SeverityText === 'ERROR' || log.SeverityText === 'FATAL' ? 'font-bold text-red-700' :
                            log.SeverityText === 'WARN' ? 'font-bold text-yellow-700' :
                            log.SeverityText === 'DEBUG' ? 'text-gray-500' :
                            'text-black';

                          return (
                            <tr key={i} className={`hover:bg-gray-100 ${severityClass}`}>
                              <td className="p-2 text-gray-600 whitespace-nowrap">
                                {new Date(log.Timestamp).toLocaleTimeString('en-US', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  fractionalSecondDigits: 3,
                                  hour12: false
                                })}
                              </td>
                              <td className={`p-2 whitespace-nowrap ${severityText}`}>
                                {log.SeverityText || 'INFO'}
                              </td>
                              <td className="p-2 text-gray-700 whitespace-nowrap">
                                {log.HostName || '-'}
                              </td>
                              <td className="p-2 text-gray-600 max-w-xs truncate" title={log.ScopeName}>
                                {log.ScopeName}
                              </td>
                              <td className="p-2 text-black">
                                {log.Body}
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
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
