'use client';

import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Server,
  Database
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
  duration_seconds: number;
  StatusCode: string;
  SpanAttributes: string;
}

interface RecentError {
  Timestamp: string;
  TraceId: string;
  ServiceName: string;
  SpanName: string;
  duration_seconds: number;
  SpanAttributes: string;
}

export default function ObservabilityPage() {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('24');
  const [activeTab, setActiveTab] = useState<'overview' | 'executions' | 'tools' | 'errors'>('overview');

  // Data states
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth[]>([]);
  const [toolUsage, setToolUsage] = useState<ToolUsage[]>([]);
  const [recentExecutions, setRecentExecutions] = useState<RecentExecution[]>([]);
  const [recentErrors, setRecentErrors] = useState<RecentError[]>([]);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

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
          setServiceHealth(overviewData.data || []);
          setToolUsage(toolsData.data || []);
        }
      } else {
        const response = await fetch(`/api/observability/telemetry?metric=${metric}&hours=${timeRange}`);
        if (response.ok) {
          const data = await response.json();

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
        }
      }

      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch telemetry data:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [activeTab, timeRange, checkAccess]);

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

  const getStatusColor = (statusCode: string) => {
    return statusCode === 'STATUS_CODE_ERROR' ? 'bg-black text-white' : 'bg-white text-black border-2 border-black';
  };

  const getHealthColor = (errorRate: number) => {
    if (errorRate === 0) return 'bg-white text-black border-2 border-black';
    if (errorRate < 5) return 'bg-gray-200 text-gray-800';
    return 'bg-black text-white';
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
              Updated: {lastRefresh.toLocaleTimeString()}
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
        </div>

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
                            <span>{new Date(service.last_seen).toLocaleTimeString()}</span>
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
                    <table className="w-full">
                      <thead className="bg-black text-white">
                        <tr>
                          <th className="text-left p-3 font-mono">Tool</th>
                          <th className="text-left p-3 font-mono">Executions</th>
                          <th className="text-left p-3 font-mono">Avg Duration</th>
                          <th className="text-left p-3 font-mono">Failure Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {toolUsage.slice(0, 10).map((tool) => (
                          <tr key={tool.tool} className="border-t border-gray-200 hover:bg-gray-50">
                            <td className="p-3 font-mono text-sm">{tool.tool}</td>
                            <td className="p-3 font-mono text-sm">{tool.executions.toLocaleString()}</td>
                            <td className="p-3 font-mono text-sm">{formatDuration(tool.avg_seconds)}</td>
                            <td className="p-3">
                              <span className={`font-mono text-xs px-2 py-1 ${
                                tool.failure_rate === 0 ? 'bg-white border border-gray-300' :
                                tool.failure_rate < 5 ? 'bg-gray-200' : 'bg-black text-white'
                              }`}>
                                {tool.failure_rate.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'executions' && (
              <div>
                <h2 className="text-lg font-mono font-bold mb-4">RECENT WORKFLOW EXECUTIONS</h2>
                <div className="border-2 border-black overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-black text-white">
                      <tr>
                        <th className="text-left p-3 font-mono">Timestamp</th>
                        <th className="text-left p-3 font-mono">Service</th>
                        <th className="text-left p-3 font-mono">Duration</th>
                        <th className="text-left p-3 font-mono">Status</th>
                        <th className="text-left p-3 font-mono">Trace ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentExecutions.map((execution, index) => (
                        <tr key={`${execution.TraceId}-${index}`} className="border-t border-gray-200 hover:bg-gray-50">
                          <td className="p-3 font-mono text-sm">
                            {new Date(execution.Timestamp).toLocaleString()}
                          </td>
                          <td className="p-3 font-mono text-sm">{execution.ServiceName}</td>
                          <td className="p-3 font-mono text-sm">{formatDuration(execution.duration_seconds)}</td>
                          <td className="p-3">
                            <span className={`font-mono text-xs px-2 py-1 ${getStatusColor(execution.StatusCode)}`}>
                              {execution.StatusCode === 'STATUS_CODE_OK' ? 'SUCCESS' : 'ERROR'}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-xs text-gray-600">
                            {execution.TraceId.substring(0, 16)}...
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'tools' && (
              <div>
                <h2 className="text-lg font-mono font-bold mb-4">TOOL USAGE STATISTICS</h2>
                <div className="border-2 border-black overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-black text-white">
                      <tr>
                        <th className="text-left p-3 font-mono">Tool Name</th>
                        <th className="text-left p-3 font-mono">Executions</th>
                        <th className="text-left p-3 font-mono">Avg Duration</th>
                        <th className="text-left p-3 font-mono">Max Duration</th>
                        <th className="text-left p-3 font-mono">Failures</th>
                        <th className="text-left p-3 font-mono">Failure Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {toolUsage.map((tool) => (
                        <tr key={tool.tool} className="border-t border-gray-200 hover:bg-gray-50">
                          <td className="p-3 font-mono text-sm font-bold">{tool.tool}</td>
                          <td className="p-3 font-mono text-sm">{tool.executions.toLocaleString()}</td>
                          <td className="p-3 font-mono text-sm">{formatDuration(tool.avg_seconds)}</td>
                          <td className="p-3 font-mono text-sm">{formatDuration(tool.max_seconds)}</td>
                          <td className="p-3 font-mono text-sm">{tool.failures.toLocaleString()}</td>
                          <td className="p-3">
                            <span className={`font-mono text-xs px-2 py-1 ${
                              tool.failure_rate === 0 ? 'bg-white border border-gray-300' :
                              tool.failure_rate < 5 ? 'bg-gray-200' : 'bg-black text-white'
                            }`}>
                              {tool.failure_rate.toFixed(2)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'errors' && (
              <div>
                <h2 className="text-lg font-mono font-bold mb-4">RECENT ERRORS</h2>
                <div className="border-2 border-black overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-black text-white">
                      <tr>
                        <th className="text-left p-3 font-mono">Timestamp</th>
                        <th className="text-left p-3 font-mono">Service</th>
                        <th className="text-left p-3 font-mono">Operation</th>
                        <th className="text-left p-3 font-mono">Duration</th>
                        <th className="text-left p-3 font-mono">Trace ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentErrors.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-6 text-center font-mono text-gray-600">
                            No errors in the selected time range
                          </td>
                        </tr>
                      ) : (
                        recentErrors.map((error, index) => (
                          <tr key={`${error.TraceId}-${index}`} className="border-t border-gray-200 hover:bg-gray-50">
                            <td className="p-3 font-mono text-sm">
                              {new Date(error.Timestamp).toLocaleString()}
                            </td>
                            <td className="p-3 font-mono text-sm">{error.ServiceName}</td>
                            <td className="p-3 font-mono text-sm">{error.SpanName}</td>
                            <td className="p-3 font-mono text-sm">{formatDuration(error.duration_seconds)}</td>
                            <td className="p-3 font-mono text-xs text-gray-600">
                              {error.TraceId.substring(0, 16)}...
                            </td>
                          </tr>
                        ))
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