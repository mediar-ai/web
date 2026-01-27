'use client';

import { useState, useCallback } from 'react';
import { Activity, Server, Clock } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';
import { fetchJson } from '@/lib/fetch-utils';

interface TraceData {
  hostname: string;
  deploymentType: string;
  count: number;
}

interface TracesResponse {
  traces: TraceData[];
  meta: {
    statsPeriod: string;
    total: number;
    fetchedAt: string;
  };
}

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function ObservabilityPage() {
  const [statsPeriod, setStatsPeriod] = useState('7d');

  const fetchTraces = useCallback(async (): Promise<TracesResponse> => {
    console.log('[observability] Fetching traces for period:', statsPeriod);
    const data = await fetchJson<TracesResponse>(`/api/admin/sentry-traces?statsPeriod=${statsPeriod}`);
    
    console.log('[observability] Got', data.traces.length, 'traces');
    return data;
  }, [statsPeriod]);

  const {
    data,
    loading,
    isRefreshing,
    autoRefreshEnabled,
    toggleAutoRefresh,
    refresh,
    lastUpdatedAgo,
  } = useAutoRefresh(fetchTraces, {
    interval: REFRESH_INTERVAL,
    storageKey: 'admin-observability-auto-refresh',
  });

  const traces = data?.traces || [];
  const lastFetched = data?.meta?.fetchedAt || null;

  const totalCount = traces.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Activity className="w-6 h-6" />
            SENTRY TRACES BY HOSTNAME
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Total spans for: terminator::new
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statsPeriod}
            onChange={e => setStatsPeriod(e.target.value)}
            className="px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none"
          >
            <option value="1h">Last 1 hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="14d">Last 14 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <AutoRefreshControls
            loading={loading}
            isRefreshing={isRefreshing}
            autoRefreshEnabled={autoRefreshEnabled}
            lastUpdatedAgo={lastUpdatedAgo}
            intervalSeconds={REFRESH_INTERVAL / 1000}
            onRefresh={refresh}
            onToggleAutoRefresh={toggleAutoRefresh}
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Unique Hosts</div>
          <div className="font-mono font-bold text-xl">{traces.length}</div>
        </div>
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase">Total Traces</div>
          <div className="font-mono font-bold text-xl">{totalCount.toLocaleString()}</div>
        </div>
        <div className="border-2 border-black p-3">
          <div className="font-mono text-xs text-gray-600 uppercase flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Last Updated
          </div>
          <div className="font-mono font-bold text-sm">
            {lastFetched ? new Date(lastFetched).toLocaleTimeString() : '-'}
          </div>
        </div>
      </div>

      {/* Traces Table */}
      {loading && !data ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      ) : traces.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed border-gray-400">
          <Server className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p className="font-mono text-gray-600">No traces found for this period</p>
        </div>
      ) : (
        <div className="border-2 border-black">
          <table className="w-full">
            <thead className="bg-black text-white">
              <tr>
                <th className="font-mono text-xs uppercase text-left px-4 py-2">#</th>
                <th className="font-mono text-xs uppercase text-left px-4 py-2">Hostname</th>
                <th className="font-mono text-xs uppercase text-left px-4 py-2">Deployment</th>
                <th className="font-mono text-xs uppercase text-right px-4 py-2">Trace Count</th>
                <th className="font-mono text-xs uppercase text-right px-4 py-2">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace, index) => {
                const percentage = totalCount > 0 ? ((trace.count / totalCount) * 100).toFixed(1) : '0';
                const deploymentColor = trace.deploymentType === 'oss'
                  ? 'bg-green-100 text-green-800'
                  : trace.deploymentType === 'desktop-client'
                    ? 'bg-blue-100 text-blue-800'
                    : trace.deploymentType === 'backend-vm'
                      ? 'bg-purple-100 text-purple-800'
                      : 'bg-gray-100 text-gray-800';
                return (
                  <tr
                    key={`${trace.hostname}-${trace.deploymentType}`}
                    className={`border-t border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="font-mono text-sm px-4 py-2 text-gray-500">{index + 1}</td>
                    <td className="font-mono text-sm px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-gray-400" />
                        {trace.hostname}
                      </div>
                    </td>
                    <td className="font-mono text-sm px-4 py-2">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${deploymentColor}`}>
                        {trace.deploymentType}
                      </span>
                    </td>
                    <td className="font-mono text-sm px-4 py-2 text-right font-bold">
                      {trace.count.toLocaleString()}
                    </td>
                    <td className="font-mono text-sm px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div
                          className="h-2 bg-black"
                          style={{ width: `${Math.min(parseFloat(percentage), 100)}%`, minWidth: '2px' }}
                        />
                        <span className="w-12 text-right">{percentage}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
