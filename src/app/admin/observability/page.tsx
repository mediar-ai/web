'use client';

import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Search, AlertCircle, CheckCircle, Clock, Server } from 'lucide-react';
import { toast } from 'sonner';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  service: string;
  message: string;
  traceId?: string;
}

interface TraceEntry {
  traceId: string;
  service: string;
  operation: string;
  duration: number;
  status: 'ok' | 'error';
  timestamp: string;
}

interface MetricSummary {
  totalTraces: number;
  errorRate: number;
  avgDuration: number;
  activeServices: number;
}

export default function AdminObservabilityPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [metrics, setMetrics] = useState<MetricSummary>({
    totalTraces: 0,
    errorRate: 0,
    avgDuration: 0,
    activeServices: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'logs' | 'traces'>('logs');
  const [searchQuery, setSearchQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('all');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch logs from ClickHouse via API
      const logsRes = await fetch('/api/admin/observability/logs?limit=100');
      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.logs || []);
      }

      // Fetch traces
      const tracesRes = await fetch('/api/admin/observability/traces?limit=50');
      if (tracesRes.ok) {
        const data = await tracesRes.json();
        setTraces(data.traces || []);

        // Calculate metrics
        const totalTraces = data.traces?.length || 0;
        const errorTraces = data.traces?.filter((t: TraceEntry) => t.status === 'error').length || 0;
        const avgDuration =
          totalTraces > 0
            ? data.traces.reduce((sum: number, t: TraceEntry) => sum + t.duration, 0) / totalTraces
            : 0;
        const services = new Set(data.traces?.map((t: TraceEntry) => t.service) || []);

        setMetrics({
          totalTraces,
          errorRate: totalTraces > 0 ? (errorTraces / totalTraces) * 100 : 0,
          avgDuration,
          activeServices: services.size,
        });
      }
    } catch (error) {
      console.error('Failed to fetch observability data:', error);
      toast.error('Failed to load observability data');
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch =
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.service.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesLevel = levelFilter === 'all' || log.level === levelFilter;
    return matchesSearch && matchesLevel;
  });

  const filteredTraces = traces.filter(
    trace =>
      trace.operation.toLowerCase().includes(searchQuery.toLowerCase()) ||
      trace.service.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getLevelStyles = (level: string) => {
    switch (level) {
      case 'error':
        return 'bg-black text-white font-bold';
      case 'warn':
        return 'bg-gray-200 text-black';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

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
            Logs, traces, and system metrics from ClickHouse
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
        </div>
      ) : (
        <>
          {/* Metrics Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Traces</span>
              </div>
              <div className="font-mono font-bold text-2xl">{metrics.totalTraces}</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Error Rate</span>
              </div>
              <div className="font-mono font-bold text-2xl">{metrics.errorRate.toFixed(1)}%</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Avg Duration</span>
              </div>
              <div className="font-mono font-bold text-2xl">{metrics.avgDuration.toFixed(0)}ms</div>
            </div>
            <div className="border-2 border-black p-4">
              <div className="flex items-center gap-2 mb-2">
                <Server className="w-5 h-5" />
                <span className="font-mono text-xs text-gray-600 uppercase">Services</span>
              </div>
              <div className="font-mono font-bold text-2xl">{metrics.activeServices}</div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-2 border-black mb-4">
            <button
              onClick={() => setActiveTab('logs')}
              className={`flex-1 px-4 py-2 font-mono text-sm ${
                activeTab === 'logs' ? 'bg-black text-white' : 'bg-white hover:bg-gray-100'
              }`}
            >
              LOGS ({logs.length})
            </button>
            <button
              onClick={() => setActiveTab('traces')}
              className={`flex-1 px-4 py-2 font-mono text-sm border-l-2 border-black ${
                activeTab === 'traces' ? 'bg-black text-white' : 'bg-white hover:bg-gray-100'
              }`}
            >
              TRACES ({traces.length})
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-black"
              />
            </div>
            {activeTab === 'logs' && (
              <div className="flex border-2 border-black">
                {(['all', 'info', 'warn', 'error'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setLevelFilter(level)}
                    className={`px-3 py-1 font-mono text-sm ${
                      levelFilter === level
                        ? 'bg-black text-white'
                        : 'bg-white hover:bg-gray-100'
                    }`}
                  >
                    {level.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Content */}
          <div className="border-2 border-black">
            {activeTab === 'logs' ? (
              filteredLogs.length === 0 ? (
                <div className="p-8 text-center font-mono text-gray-600">
                  No logs found. Configure ClickHouse API endpoint.
                </div>
              ) : (
                <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                  {filteredLogs.map((log, idx) => (
                    <div key={idx} className="p-3 font-mono text-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`px-2 py-0.5 text-xs ${getLevelStyles(log.level)}`}>
                          {log.level.toUpperCase()}
                        </span>
                        <span className="text-gray-500">{log.service}</span>
                        <span className="text-gray-400 text-xs">
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-gray-800 break-all">{log.message}</div>
                      {log.traceId && (
                        <div className="text-xs text-gray-400 mt-1">
                          Trace: {log.traceId}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : filteredTraces.length === 0 ? (
              <div className="p-8 text-center font-mono text-gray-600">
                No traces found. Configure ClickHouse API endpoint.
              </div>
            ) : (
              <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                {filteredTraces.map((trace, idx) => (
                  <div key={idx} className="p-3 font-mono text-sm flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        {trace.status === 'ok' ? (
                          <CheckCircle className="w-4 h-4" />
                        ) : (
                          <AlertCircle className="w-4 h-4" />
                        )}
                        <span className="font-bold">{trace.operation}</span>
                      </div>
                      <div className="text-gray-500 text-xs mt-1">
                        {trace.service} - {new Date(trace.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold">{trace.duration}ms</div>
                      <div className="text-xs text-gray-400">{trace.traceId.slice(0, 8)}...</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
