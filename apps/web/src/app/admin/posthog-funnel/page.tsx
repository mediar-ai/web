'use client';

import { useCallback } from 'react';
import { BarChart3, TrendingUp, TrendingDown } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';
import { fetchJson } from '@/lib/fetch-utils';

interface FunnelRow {
  event: string;
  value7d: string;
  change7d: number | null;
  convRate7d: string;
  value30d: string;
  change30d: number | null;
  convRate30d: string;
  sortOrder: number;
  category: 'main' | 'desktop';
}

interface FunnelStep {
  name: string;
  count: number;
  percent: number;
  prevCount?: number;
  change?: number | null;
}

interface ActivationFunnel {
  steps: FunnelStep[];
  conversionRate: string;
  prevConversionRate?: string;
}

interface FunnelData {
  rows: FunnelRow[];
  activationFunnel: ActivationFunnel | null;
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

function formatChangeText(change: number | null): string {
  if (change === null) return '';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(0)}%`;
}

function ActivationFunnelChart({ funnel }: { funnel: ActivationFunnel }) {
  const maxCount = funnel.steps[0]?.count || 1;
  const convChange = funnel.prevConversionRate
    ? Number(funnel.conversionRate) - Number(funnel.prevConversionRate)
    : null;

  return (
    <div className="border-2 border-black">
      <div className="bg-gray-100 border-b-2 border-black px-3 py-2 flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase">Download → Chat Activation (7d, Windows)</h2>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm bg-black text-white px-2 py-0.5">
            {funnel.conversionRate}% end-to-end
          </span>
          {convChange !== null && (
            <span className={`font-mono text-sm px-2 py-0.5 ${convChange >= 0 ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>
              {convChange >= 0 ? '+' : ''}{convChange.toFixed(1)}pp vs prev week
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {/* Legend */}
        <div className="flex justify-end gap-4 mb-2 text-xs font-mono text-gray-500">
          <span>This week vs last week</span>
        </div>
        <div className="flex gap-4">
          {funnel.steps.map((step, i) => {
            const height = (step.count / maxCount) * 100;
            const dropoff = i > 0 ? funnel.steps[i - 1].count - step.count : 0;
            const dropoffPercent = i > 0 && funnel.steps[i - 1].count > 0
              ? Math.round((dropoff / funnel.steps[i - 1].count) * 100)
              : 0;

            return (
              <div key={step.name} className="flex-1 flex flex-col items-center">
                {/* Bar container - fixed height, bars align to bottom */}
                <div className="w-full h-32 flex items-end justify-center">
                  <div
                    className="w-full max-w-24 bg-blue-500 transition-all"
                    style={{ height: `${height}%`, minHeight: step.count > 0 ? '8px' : '0' }}
                  />
                </div>
                {/* Label */}
                <div className="text-xs font-mono font-bold text-center mt-2">{step.name}</div>
                {/* This week count */}
                <div className="text-sm font-mono font-bold mt-1">
                  {step.count}
                  <span className="text-gray-400 font-normal"> ({step.percent}%)</span>
                </div>
                {/* Last week comparison */}
                <div className="text-xs font-mono text-gray-400 flex items-center gap-1">
                  was {step.prevCount ?? 0}
                  {step.change !== null && step.change !== undefined && (
                    <span className={step.change >= 0 ? 'text-green-600' : 'text-red-600'}>
                      ({formatChangeText(step.change)})
                    </span>
                  )}
                </div>
                {/* Dropoff from previous step */}
                <div className="h-4 text-xs font-mono text-red-500 mt-1">
                  {i > 0 && dropoff > 0 ? `↓ ${dropoffPercent}% lost` : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const REFRESH_INTERVAL = 60000; // 60 seconds

export default function PostHogFunnelPage() {
  const fetchData = useCallback(async (): Promise<FunnelData> => {
    console.log('[posthog-funnel-page] Fetching data...');
    const d = await fetchJson<FunnelData>('/api/admin/posthog-funnel');
    
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
  const mainRows = rows.filter(row => row.category === 'main');
  const desktopRows = rows.filter(row => row.category === 'desktop');

  const renderTable = (tableRows: FunnelRow[], title?: string) => (
    <div className="border-2 border-black">
      {title && (
        <div className="bg-gray-100 border-b-2 border-black px-3 py-2">
          <h2 className="font-mono font-bold text-sm uppercase">{title}</h2>
        </div>
      )}
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
          {tableRows.map((row, index) => {
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
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            POSTHOG DASHBOARD
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
        <div className="space-y-6">
          {/* Activation Funnel Chart */}
          {data?.activationFunnel && (
            <ActivationFunnelChart funnel={data.activationFunnel} />
          )}

          {/* Main Funnel Table */}
          {mainRows.length > 0 && renderTable(mainRows, 'Main Dashboard')}

          {/* Desktop App Events Table */}
          {desktopRows.length > 0 && renderTable(desktopRows, 'Desktop App Events')}
        </div>
      )}
    </div>
  );
}
