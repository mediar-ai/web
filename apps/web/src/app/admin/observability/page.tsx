'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, RefreshCw, Server, Clock } from 'lucide-react';
import { toast } from 'sonner';

interface TraceData {
  hostname: string;
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

export default function ObservabilityPage() {
  const [traces, setTraces] = useState<TraceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsPeriod, setStatsPeriod] = useState('7d');
  const [lastFetched, setLastFetched] = useState<string | null>(null);

  const fetchTraces = useCallback(async () => {
    console.log('[observability] Fetching traces for period:', statsPeriod);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sentry-traces?statsPeriod=${statsPeriod}`);
      if (res.ok) {
        const data: TracesResponse = await res.json();
        console.log('[observability] Got', data.traces.length, 'traces');
        setTraces(data.traces);
        setLastFetched(data.meta.fetchedAt);
      } else {
        const error = await res.json();
        console.error('[observability] API error:', error);
        toast.error(error.error || 'Failed to load traces');
      }
    } catch (error) {
      console.error('[observability] Fetch error:', error);
      toast.error('Failed to fetch traces');
    } finally {
      setLoading(false);
    }
  }, [statsPeriod]);

  useEffect(() => {
    fetchTraces();
  }, [fetchTraces]);

  const totalCount = traces.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <Activity className="w-6 h-6" />
            OBSERVABILITY
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Sentry traces by hostname
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
          <button
            onClick={() => {
              setLoading(true);
              fetchTraces();
            }}
            className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
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
      {loading ? (
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
                <th className="font-mono text-xs uppercase text-right px-4 py-2">Trace Count</th>
                <th className="font-mono text-xs uppercase text-right px-4 py-2">% of Total</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace, index) => {
                const percentage = totalCount > 0 ? ((trace.count / totalCount) * 100).toFixed(1) : '0';
                return (
                  <tr
                    key={trace.hostname}
                    className={`border-t border-gray-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="font-mono text-sm px-4 py-2 text-gray-500">{index + 1}</td>
                    <td className="font-mono text-sm px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-gray-400" />
                        {trace.hostname}
                      </div>
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
