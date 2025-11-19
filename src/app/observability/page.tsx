'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  RefreshCw,
  Database,
  Search,
  Filter,
  X,
  AlertCircle,
  Info,
  AlertTriangle,
  ChevronDown
} from 'lucide-react';

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
  const [deduplicateLogs, setDeduplicateLogs] = useState(false);
  const [groupByTrace, setGroupByTrace] = useState(false); // Default to ungrouped for performance
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());
  const [logsToShow, setLogsToShow] = useState(50); // Pagination: show 50 logs at a time
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

  // Fetch logs
  const fetchData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setIsRefreshing(true);

      const hasAccess = await checkAccess();
      if (!hasAccess) return;

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

      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [timeRange, logHostFilter, logScopeFilter, logSeverityFilter, searchQuery, checkAccess, availableFilters.hosts.length]);

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
  }, [logHostFilter, logScopeFilter, logSeverityFilter, searchQuery, groupByTrace, deduplicateLogs]);

  // Deduplicate consecutive logs
  const displayedLogs = useMemo(() => {
    if (!deduplicateLogs) return logs;

    const deduplicated: LogEntry[] = [];
    for (let i = 0; i < logs.length; i++) {
      const current = logs[i];
      const prev = logs[i - 1];

      // Check if current log is identical to previous (ignoring timestamp)
      if (prev &&
          current.Body === prev.Body &&
          current.SeverityText === prev.SeverityText &&
          current.ScopeName === prev.ScopeName &&
          current.HostName === prev.HostName) {
        continue; // Skip duplicate
      }

      deduplicated.push(current);
    }

    return deduplicated;
  }, [logs, deduplicateLogs]);

  // Group logs by TraceID (Vercel-style)
  const groupedLogs = useMemo(() => {
    if (!groupByTrace) return null;

    // ONLY show logs with valid TraceIDs when grouping is enabled
    const logsWithTraceId = displayedLogs.filter(log =>
      log.TraceId &&
      log.TraceId.trim() !== '' &&
      log.TraceId !== '00000000000000000000000000000000'
    );

    // Apply pagination BEFORE grouping for performance
    const paginatedLogs = logsWithTraceId.slice(0, logsToShow);

    const groups = new Map<string, LogEntry[]>();

    paginatedLogs.forEach(log => {
      const traceId = log.TraceId!; // Safe because we filtered above

      if (!groups.has(traceId)) {
        groups.set(traceId, []);
      }
      groups.get(traceId)!.push(log);
    });

    return Array.from(groups.entries()).map(([traceId, entries]) => {
      // Sort logs by timestamp within group
      const sortedEntries = entries.sort((a, b) =>
        new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime()
      );

      return {
        traceId,
        logs: sortedEntries,
        errorCount: sortedEntries.filter(e => e.SeverityText === 'ERROR' || e.SeverityText === 'FATAL').length,
        warnCount: sortedEntries.filter(e => e.SeverityText === 'WARN').length,
        infoCount: sortedEntries.filter(e => e.SeverityText === 'INFO').length,
        debugCount: sortedEntries.filter(e => e.SeverityText === 'DEBUG').length,
      };
    }).sort((a, b) => {
      // Sort groups by first log timestamp (newest first)
      const aTime = new Date(a.logs[0].Timestamp).getTime();
      const bTime = new Date(b.logs[0].Timestamp).getTime();
      return bTime - aTime;
    });
  }, [displayedLogs, groupByTrace, logsToShow]);

  const toggleTrace = (traceId: string) => {
    setExpandedTraces(prev => {
      const newSet = new Set(prev);
      if (newSet.has(traceId)) {
        newSet.delete(traceId);
      } else {
        newSet.add(traceId);
      }
      return newSet;
    });
  };

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
    const utcTimestamp = timestamp.includes('Z') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
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
        hour12: false
      });
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const formatLocalTimeOnly = (timestamp: string) => {
    if (!timestamp || timestamp === '') return 'N/A';

    // ClickHouse returns timestamps in UTC without timezone indicator
    // Format: "2025-10-10 23:54:35.400410500"
    // We need to append 'Z' to indicate UTC before parsing
    const utcTimestamp = timestamp.includes('Z') ? timestamp : timestamp.replace(' ', 'T') + 'Z';
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
      timeZoneName: 'short'
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
          <p className="font-mono text-gray-600 mb-4">System logs from all services</p>

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

            {/* Log Count */}
            <span className="ml-auto text-sm font-mono font-bold">
              {groupByTrace
                ? `${Math.min(logsToShow, displayedLogs.filter(log => log.TraceId && log.TraceId.trim() !== '' && log.TraceId !== '00000000000000000000000000000000').length)} / ${displayedLogs.filter(log => log.TraceId && log.TraceId.trim() !== '' && log.TraceId !== '00000000000000000000000000000000').length} logs with traces`
                : `${Math.min(logsToShow, displayedLogs.length)} / ${displayedLogs.length} logs`
              }
            </span>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Search logs by message, host, scope..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 border-2 border-black font-mono"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="mb-4">
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

            {/* Group by Trace Checkbox */}
            <label className="flex items-center gap-2 px-3 py-1.5 border-2 border-black bg-white cursor-pointer hover:bg-gray-100">
              <input
                type="checkbox"
                checked={groupByTrace}
                onChange={(e) => setGroupByTrace(e.target.checked)}
                className="w-4 h-4 border-2 border-black focus:ring-2 focus:ring-black cursor-pointer"
              />
              <span className="font-mono text-xs uppercase font-bold">GROUP BY TRACE</span>
            </label>

            {/* Deduplicate Checkbox */}
            <label className="flex items-center gap-2 px-3 py-1.5 border-2 border-black bg-white cursor-pointer hover:bg-gray-100">
              <input
                type="checkbox"
                checked={deduplicateLogs}
                onChange={(e) => setDeduplicateLogs(e.target.checked)}
                className="w-4 h-4 border-2 border-black focus:ring-2 focus:ring-black cursor-pointer"
              />
              <span className="font-mono text-xs uppercase font-bold">DEDUPE</span>
            </label>

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
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="border-2 border-black p-3 animate-pulse">
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
            {/* Grouped View (Vercel-style) */}
            {groupByTrace && groupedLogs ? (
              <div className="space-y-1">
                {groupedLogs.length === 0 ? (
                  <div className="border-2 border-black p-8 text-center text-gray-600 font-mono">
                    No logs found {logHostFilter || logSeverityFilter || logScopeFilter || searchQuery ? 'matching filters' : 'in selected time range'}
                  </div>
                ) : (
                  groupedLogs.map((group, groupIdx) => {
                    const isExpanded = expandedTraces.has(group.traceId);
                    const firstLog = group.logs[0];
                    const severity = firstLog.SeverityText || 'INFO';

                    return (
                      <div key={groupIdx} className="border border-gray-300">
                        {/* Group Header */}
                        <button
                          onClick={() => toggleTrace(group.traceId)}
                          className="w-full hover:bg-gray-50 p-2 text-left transition-colors border-b border-gray-300"
                        >
                          <div className="flex items-center gap-3 font-mono text-xs">
                            <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />

                            {/* Time */}
                            <span className="text-gray-500 w-20 flex-shrink-0">
                              {formatTimeCompact(firstLog.Timestamp)}
                            </span>

                            {/* Log Count */}
                            <span className="font-bold text-black w-20 flex-shrink-0">
                              {group.logs.length} {group.logs.length === 1 ? 'log' : 'logs'}
                            </span>

                            {/* Summary Counts */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {group.errorCount > 0 && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-900 border border-red-300 rounded-sm font-bold">
                                  {group.errorCount} ERROR
                                </span>
                              )}
                              {group.warnCount > 0 && (
                                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-900 border border-yellow-300 rounded-sm font-bold">
                                  {group.warnCount} WARN
                                </span>
                              )}
                              {group.infoCount > 0 && (
                                <span className="text-gray-600">
                                  {group.infoCount} INFO
                                </span>
                              )}
                            </div>

                            {/* First message preview */}
                            <span className="flex-1 truncate text-gray-700">
                              {firstLog.Body}
                            </span>

                            {/* TraceID badge */}
                            <span className="text-gray-500 text-[10px] font-mono flex-shrink-0">
                              {group.traceId.slice(0, 8)}...
                            </span>
                          </div>
                        </button>

                        {/* Expanded Logs */}
                        {isExpanded && (
                          <div className="bg-gray-50">
                            {group.logs.map((log, logIdx) => {
                              const isSelected = selectedLog === log;
                              const logSeverity = log.SeverityText || 'INFO';

                              return (
                                <div key={logIdx} className="border-l-2 border-black ml-4">
                                  {/* Log Line */}
                                  <button
                                    onClick={() => setSelectedLog(isSelected ? null : log)}
                                    className="w-full hover:bg-white p-2 pl-4 text-left transition-colors border-b border-gray-200"
                                  >
                                    <div className="flex items-center gap-3 font-mono text-xs">
                                      {/* Time */}
                                      <span className="text-gray-500 w-20 flex-shrink-0">
                                        {formatTimeCompact(log.Timestamp)}
                                      </span>

                                      {/* Severity Badge */}
                                      <span className={`px-2 py-0.5 border rounded-sm flex items-center gap-1 ${getSeverityClass(logSeverity)} flex-shrink-0`}>
                                        {getSeverityIcon(logSeverity)}
                                        {logSeverity}
                                      </span>

                                      {/* Host */}
                                      <span className="text-gray-600 w-32 truncate flex-shrink-0" title={log.HostName || '-'}>
                                        {log.HostName || '-'}
                                      </span>

                                      {/* Message */}
                                      <span className="flex-1 truncate text-black">
                                        {log.Body}
                                      </span>

                                      {/* Expand Icon */}
                                      <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                                    </div>
                                  </button>

                                  {/* Expanded Log Details */}
                                  {isSelected && (
                                    <div className="bg-white border-2 border-black p-4 space-y-3 m-2 font-mono text-xs">
                                      <div className="grid grid-cols-2 gap-4">
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">Timestamp:</span>
                                          <div className="mt-1">{log.Timestamp}</div>
                                        </div>
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">Severity:</span>
                                          <div className="mt-1">{logSeverity}</div>
                                        </div>
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">Host:</span>
                                          <div className="mt-1">{log.HostName || 'N/A'}</div>
                                        </div>
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">Service:</span>
                                          <div className="mt-1">{log.ServiceName || 'N/A'}</div>
                                        </div>
                                      </div>

                                      <div>
                                        <span className="font-bold uppercase text-gray-600">Scope:</span>
                                        <div className="mt-1 p-2 bg-gray-50 border border-gray-300 break-all">
                                          {log.ScopeName}
                                        </div>
                                      </div>

                                      <div>
                                        <span className="font-bold uppercase text-gray-600">Message:</span>
                                        <div className="mt-1 p-2 bg-gray-50 border border-gray-300 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                                          {log.Body}
                                        </div>
                                      </div>

                                      {log.TraceId && (
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">Trace ID:</span>
                                          <div className="mt-1 p-2 bg-gray-50 border border-gray-300 break-all">
                                            {log.TraceId}
                                          </div>
                                        </div>
                                      )}

                                      {log.SpanId && (
                                        <div>
                                          <span className="font-bold uppercase text-gray-600">Span ID:</span>
                                          <div className="mt-1 p-2 bg-gray-50 border border-gray-300 break-all">
                                            {log.SpanId}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* Ungrouped View (Original) */
              <div className="space-y-1">
                {displayedLogs.length === 0 ? (
                  <div className="border-2 border-black p-8 text-center text-gray-600 font-mono">
                    No logs found {logHostFilter || logSeverityFilter || logScopeFilter || searchQuery ? 'matching filters' : 'in selected time range'}
                  </div>
                ) : (
                  displayedLogs.slice(0, logsToShow).map((log, i) => {
                    const isSelected = selectedLog === log;
                    const severity = log.SeverityText || 'INFO';

                    return (
                      <div key={i}>
                        {/* Compact Log Line */}
                        <button
                          onClick={() => setSelectedLog(isSelected ? null : log)}
                          className="w-full border border-gray-300 hover:border-black hover:bg-gray-50 p-2 text-left transition-colors"
                        >
                          <div className="flex items-center gap-3 font-mono text-xs">
                            {/* Time */}
                            <span className="text-gray-500 w-20 flex-shrink-0">
                              {formatTimeCompact(log.Timestamp)}
                            </span>

                            {/* Severity Badge */}
                            <span className={`px-2 py-0.5 border rounded-sm flex items-center gap-1 ${getSeverityClass(severity)} flex-shrink-0`}>
                              {getSeverityIcon(severity)}
                              {severity}
                            </span>

                            {/* Host */}
                            <span className="text-gray-600 w-32 truncate flex-shrink-0" title={log.HostName || '-'}>
                              {log.HostName || '-'}
                            </span>

                            {/* Message (truncated) */}
                            <span className="flex-1 truncate text-black">
                              {log.Body}
                            </span>

                            {/* Expand Icon */}
                            <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                          </div>
                        </button>

                        {/* Expanded Details */}
                        {isSelected && (
                          <div className="border-2 border-black bg-gray-50 p-4 space-y-3 mb-1 font-mono text-xs">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <span className="font-bold uppercase text-gray-600">Timestamp:</span>
                                <div className="mt-1">{log.Timestamp}</div>
                              </div>
                              <div>
                                <span className="font-bold uppercase text-gray-600">Severity:</span>
                                <div className="mt-1">{severity}</div>
                              </div>
                              <div>
                                <span className="font-bold uppercase text-gray-600">Host:</span>
                                <div className="mt-1">{log.HostName || 'N/A'}</div>
                              </div>
                              <div>
                                <span className="font-bold uppercase text-gray-600">Service:</span>
                                <div className="mt-1">{log.ServiceName || 'N/A'}</div>
                              </div>
                            </div>

                            <div>
                              <span className="font-bold uppercase text-gray-600">Scope:</span>
                              <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                {log.ScopeName}
                              </div>
                            </div>

                            <div>
                              <span className="font-bold uppercase text-gray-600">Message:</span>
                              <div className="mt-1 p-2 bg-white border border-gray-300 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                                {log.Body}
                              </div>
                            </div>

                            {log.TraceId && (
                              <div>
                                <span className="font-bold uppercase text-gray-600">Trace ID:</span>
                                <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                  {log.TraceId}
                                </div>
                              </div>
                            )}

                            {log.SpanId && (
                              <div>
                                <span className="font-bold uppercase text-gray-600">Span ID:</span>
                                <div className="mt-1 p-2 bg-white border border-gray-300 break-all">
                                  {log.SpanId}
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
            )}

            {/* Load More Button (Vercel-style pagination) */}
            {((groupByTrace && groupedLogs && groupedLogs.length > 0) || (!groupByTrace && displayedLogs.length > logsToShow)) && (
              <div className="flex justify-center py-6">
                <Button
                  onClick={() => setLogsToShow(prev => prev + 50)}
                  className="bg-black text-white hover:bg-gray-800 border-2 border-black font-mono text-sm uppercase"
                >
                  Load More ({logsToShow} of {groupByTrace ? displayedLogs.filter(log =>
                    log.TraceId &&
                    log.TraceId.trim() !== '' &&
                    log.TraceId !== '00000000000000000000000000000000'
                  ).length : displayedLogs.length} logs)
                </Button>
              </div>
            )}
          </>
        )}
        </div>
      </div>
    </DashboardLayout>
  );
}
