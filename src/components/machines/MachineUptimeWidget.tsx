'use client';

import { useState, useEffect } from 'react';
import { Activity, Clock, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface UptimeData {
  machine: {
    id: string;
    name: string;
    currentStatus: string;
    overallUptimePercentage: number;
    consecutiveFailures: number;
    lastHealthyAt: string | null;
    lastUnhealthyAt: string | null;
  };
  periodStats: {
    period: string;
    uptimePercentage: string;
    totalChecks: number;
    healthyChecks: number;
    avgResponseTime: number;
    downtimePeriods: number;
    totalDowntimeMs: number;
  };
  recentChecks: Array<{
    check_time: string;
    status: string;
    response_time_ms: number;
    has_taskbar: boolean;
    error_message?: string;
  }>;
}

export function MachineUptimeWidget({ machineId }: { machineId: string }) {
  const [uptimeData, setUptimeData] = useState<UptimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('24h');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUptimeData();
    // Refresh every minute
    const interval = setInterval(fetchUptimeData, 60000);
    return () => clearInterval(interval);
  }, [machineId, period]);

  const fetchUptimeData = async () => {
    try {
      const response = await fetch(`/api/machines/${machineId}/uptime?period=${period}`);
      if (response.ok) {
        const data = await response.json();
        setUptimeData(data);
        setError(null);
      } else {
        setError('Failed to fetch uptime data');
      }
    } catch (err) {
      setError('Error loading uptime data');
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (ms: number) => {
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className="border-2 border-black bg-white p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
      </div>
    );
  }

  if (error || !uptimeData) {
    return (
      <div className="border-2 border-black bg-white p-4">
        <div className="flex items-center gap-2 text-black">
          <AlertCircle className="w-4 h-4" />
          <span className="font-mono text-sm">{error || 'No data available'}</span>
        </div>
      </div>
    );
  }

  const uptimePercent = parseFloat(uptimeData.periodStats.uptimePercentage);
  const isHealthy = uptimeData.machine.currentStatus === 'healthy';

  return (
    <div className="border-2 border-black bg-white">
      <div className="bg-black text-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-mono font-bold flex items-center gap-2">
            <Activity className="w-4 h-4" />
            UPTIME MONITOR
          </h3>
          <div className="flex gap-1">
            {['1h', '24h', '7d', '30d'].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-1 font-mono text-xs border ${
                  period === p
                    ? 'bg-white text-black border-white'
                    : 'bg-black text-white border-white hover:bg-gray-800'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`w-3 h-3 rounded-full ${
                isHealthy ? 'bg-black animate-pulse' : 'bg-white border-2 border-black'
              }`}
            />
            <span className="font-mono font-bold">
              {isHealthy ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          {uptimeData.machine.consecutiveFailures > 0 && (
            <span className="font-mono text-xs bg-black text-white px-2 py-1">
              {uptimeData.machine.consecutiveFailures} FAILURES
            </span>
          )}
        </div>

        {/* Uptime Percentage */}
        <div className="border-2 border-black p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs text-gray-600">UPTIME ({period})</span>
            <span className="font-mono font-bold text-2xl">
              {uptimeData.periodStats.uptimePercentage}%
            </span>
          </div>
          <div className="w-full bg-gray-200 h-4 border border-black">
            <div
              className="bg-black h-full transition-all duration-500"
              style={{ width: `${uptimePercent}%` }}
            />
          </div>
        </div>

        {/* Statistics Grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-black p-2">
            <p className="font-mono text-xs text-gray-600">CHECKS</p>
            <p className="font-mono font-bold">
              {uptimeData.periodStats.healthyChecks}/{uptimeData.periodStats.totalChecks}
            </p>
          </div>
          <div className="border border-black p-2">
            <p className="font-mono text-xs text-gray-600">AVG RESPONSE</p>
            <p className="font-mono font-bold">{uptimeData.periodStats.avgResponseTime}ms</p>
          </div>
          <div className="border border-black p-2">
            <p className="font-mono text-xs text-gray-600">DOWNTIME</p>
            <p className="font-mono font-bold">
              {uptimeData.periodStats.downtimePeriods > 0
                ? formatDuration(uptimeData.periodStats.totalDowntimeMs)
                : 'None'}
            </p>
          </div>
          <div className="border border-black p-2">
            <p className="font-mono text-xs text-gray-600">INCIDENTS</p>
            <p className="font-mono font-bold">{uptimeData.periodStats.downtimePeriods}</p>
          </div>
        </div>

        {/* Recent Checks Timeline */}
        <div className="border-t-2 border-black pt-3">
          <p className="font-mono text-xs text-gray-600 mb-2">RECENT CHECKS</p>
          <div className="space-y-1">
            {uptimeData.recentChecks.slice(0, 5).map((check, index) => (
              <div
                key={index}
                className="flex items-center justify-between font-mono text-xs"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      check.status === 'healthy'
                        ? 'bg-black'
                        : 'bg-white border border-black'
                    }`}
                  />
                  <span className="text-gray-600">{formatTime(check.check_time)}</span>
                </div>
                <div className="flex items-center gap-2">
                  {check.has_taskbar && (
                    <span className="text-gray-400">UI✓</span>
                  )}
                  <span>{check.response_time_ms}ms</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Last Status Change */}
        {(uptimeData.machine.lastHealthyAt || uptimeData.machine.lastUnhealthyAt) && (
          <div className="border-t border-gray-200 pt-2">
            <p className="font-mono text-xs text-gray-600">
              {isHealthy ? 'ONLINE SINCE' : 'OFFLINE SINCE'}:{' '}
              <span className="text-black">
                {formatTime(
                  isHealthy
                    ? uptimeData.machine.lastHealthyAt!
                    : uptimeData.machine.lastUnhealthyAt!
                )}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}