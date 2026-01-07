'use client';

import { useCallback } from 'react';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';

interface FunnelRow {
  event: string;
  value7d: string;
  change7d: number | null;
  convRate7d: string;
  value30d: string;
  change30d: number | null;
  convRate30d: string;
  sortOrder: number;
}

interface FunnelData {
  rows: FunnelRow[];
  timestamp: string;
}

function ChangeIndicator({ change, inverse = false }: { change: number | null; inverse?: boolean }) {
  if (change === null) return null;
  // For expenses (inverse), negative is good
  const isPositive = inverse ? change <= 0 : change >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {(inverse ? change <= 0 : change >= 0) ? (
        <TrendingUp className="w-3 h-3" />
      ) : (
        <TrendingDown className="w-3 h-3" />
      )}
    </span>
  );
}

const REFRESH_INTERVAL = 60000; // 60 seconds

export default function PostHogFunnelPage() {
  const fetchData = useCallback(async (): Promise<FunnelData> => {
    console.log('[posthog-funnel-page] Fetching data...');
    const res = await fetch('/api/admin/posthog-funnel');
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to load funnel data');
    }
    const d = await res.json();
    console.log('[posthog-funnel-page] Data received:', d);
    return d;
  }, []);

  const {
    data,
    loading,
    isRefreshing,
    autoRefreshEnabled,
    toggleAutoRefresh,
    refresh,
    lastUpdatedAgo,
    error,
  } = useAutoRefresh(fetchData, {
    interval: REFRESH_INTERVAL,
    storageKey: 'admin-posthog-funnel-auto-refresh',
  });

  if (error) {
    return (
      <div className="p-6">
        <div className="border-2 border-black p-6">
          <p className="font-mono text-red-600">Error: {error}</p>
        </div>
      </div>
    );
  }

  const rows = data?.rows || [];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            FUNNEL STATS
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Product analytics, expenses, and conversions
          </p>
        </div>
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

      {loading && !data ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">Loading funnel data...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">No data available</p>
        </div>
      ) : (
        <div className="border-2 border-black">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-black bg-black text-white">
                <th className="text-left p-3 font-mono text-sm font-bold">Event</th>
                <th className="text-right p-3 font-mono text-sm font-bold">Last 7 Days</th>
                <th className="text-right p-3 font-mono text-sm font-bold">Conv. Rate</th>
                <th className="text-right p-3 font-mono text-sm font-bold">Last 30 Days</th>
                <th className="text-right p-3 font-mono text-sm font-bold">Conv. Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isExpense = row.event === 'Card Expenses';
                return (
                  <tr
                    key={row.event}
                    className={`border-b border-gray-200 hover:bg-gray-50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="p-3 font-mono text-sm font-medium">{row.event}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <span className="inline-flex items-center gap-1">
                        {row.value7d}
                        <ChangeIndicator change={row.change7d} inverse={isExpense} />
                      </span>
                    </td>
                    <td className="text-right p-3 font-mono text-sm text-gray-600">
                      {row.convRate7d || '-'}
                    </td>
                    <td className="text-right p-3 font-mono text-sm">
                      <span className="inline-flex items-center gap-1">
                        {row.value30d}
                        <ChangeIndicator change={row.change30d} inverse={isExpense} />
                      </span>
                    </td>
                    <td className="text-right p-3 font-mono text-sm text-gray-600">
                      {row.convRate30d || '-'}
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
