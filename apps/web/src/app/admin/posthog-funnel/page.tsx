'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';

interface FunnelEvent {
  event: string;
  count7d: number;
  countPrev7d: number;
  count30d: number;
  countPrev30d: number;
  change7d: number | null;
  change30d: number | null;
}

interface BrexData {
  expenses7d: number;
  expensesPrev7d: number;
  expenses30d: number;
  expensesPrev30d: number;
  change7d: number | null;
  change30d: number | null;
}

interface PageviewData {
  visitors7d: number;
  visitorsPrev7d: number;
  visitors30d: number;
  visitorsPrev30d: number;
  change7d: number | null;
  change30d: number | null;
}

interface FunnelData {
  funnel: FunnelEvent[];
  brex: BrexData | null;
  pageviews: PageviewData | null;
  error?: string;
}

function formatChange(change: number | null): string {
  if (change === null) return 'N/A';
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

function formatMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString();
}

function ChangeIndicator({ change }: { change: number | null }) {
  if (change === null) return <span className="text-gray-400">N/A</span>;
  const isPositive = change >= 0;
  return (
    <span className={`flex items-center gap-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {formatChange(change)}
    </span>
  );
}

function ChangeIndicatorInverse({ change }: { change: number | null }) {
  // For expenses, negative is good
  if (change === null) return <span className="text-gray-400">N/A</span>;
  const isPositive = change <= 0;
  return (
    <span className={`flex items-center gap-1 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
      {change <= 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
      {formatChange(change)}
    </span>
  );
}

const EVENT_LABELS: Record<string, string> = {
  'survey_completed_redirect_to_app': 'Survey Completed',
  'user_created': 'User Created',
  'desktop_app_download_clicked': 'Download Clicked',
  'desktop_app_started': 'App Started',
  'desktop_user_authenticated': 'User Authenticated',
};

export default function PostHogFunnelPage() {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    console.log('[posthog-funnel-page] Fetching data...');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/posthog-funnel');
      if (res.ok) {
        const d = await res.json();
        console.log('[posthog-funnel-page] Data received:', d);
        setData(d);
      } else {
        const error = await res.json();
        console.error('[posthog-funnel-page] API error:', error);
        toast.error(error.error || 'Failed to load funnel data');
        setData({ funnel: [], brex: null, pageviews: null, error: error.error });
      }
    } catch (err) {
      console.error('[posthog-funnel-page] Fetch error:', err);
      toast.error('Failed to fetch funnel data');
      setData({ funnel: [], brex: null, pageviews: null, error: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (data?.error) {
    return (
      <div className="p-6">
        <div className="border-2 border-black p-6">
          <p className="font-mono text-red-600">Error: {data.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono font-bold text-2xl flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            POSTHOG FUNNEL STATS
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Product analytics, expenses, and pageviews
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && !data ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">Loading funnel data...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            {/* Pageviews Card */}
            {data?.pageviews && (
              <div className="border-2 border-black p-4">
                <div className="font-mono text-xs text-gray-600 uppercase mb-2">Visitors (7d)</div>
                <div className="font-mono font-bold text-2xl">{data.pageviews.visitors7d}</div>
                <div className="font-mono text-sm mt-1">
                  <ChangeIndicator change={data.pageviews.change7d} />
                </div>
              </div>
            )}

            {/* Users Card */}
            {data?.funnel && (
              <div className="border-2 border-black p-4">
                <div className="font-mono text-xs text-gray-600 uppercase mb-2">Users Created (7d)</div>
                <div className="font-mono font-bold text-2xl">
                  {data.funnel.find(f => f.event === 'user_created')?.count7d || 0}
                </div>
                <div className="font-mono text-sm mt-1">
                  <ChangeIndicator change={data.funnel.find(f => f.event === 'user_created')?.change7d || null} />
                </div>
              </div>
            )}

            {/* Expenses Card */}
            {data?.brex && (
              <div className="border-2 border-black p-4">
                <div className="font-mono text-xs text-gray-600 uppercase mb-2">Card Expenses (7d)</div>
                <div className="font-mono font-bold text-2xl">{formatMoney(data.brex.expenses7d)}</div>
                <div className="font-mono text-sm mt-1">
                  <ChangeIndicatorInverse change={data.brex.change7d} />
                </div>
              </div>
            )}
          </div>

          {/* Funnel Table */}
          <div className="border-2 border-black">
            <div className="bg-gray-50 border-b-2 border-black p-3">
              <h2 className="font-mono font-bold">PRODUCT FUNNEL</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-black bg-gray-50">
                  <th className="text-left p-3 font-mono text-sm font-bold">Event</th>
                  <th className="text-right p-3 font-mono text-sm font-bold">7d</th>
                  <th className="text-right p-3 font-mono text-sm font-bold">Change</th>
                  <th className="text-right p-3 font-mono text-sm font-bold">30d</th>
                  <th className="text-right p-3 font-mono text-sm font-bold">Change</th>
                </tr>
              </thead>
              <tbody>
                {data?.funnel.map((item) => (
                  <tr key={item.event} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-3 font-mono text-sm">
                      {EVENT_LABELS[item.event] || item.event}
                    </td>
                    <td className="text-right p-3 font-mono text-sm font-bold">{item.count7d}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <ChangeIndicator change={item.change7d} />
                    </td>
                    <td className="text-right p-3 font-mono text-sm font-bold">{item.count30d}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <ChangeIndicator change={item.change30d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Brex Expenses Table */}
          {data?.brex && (
            <div className="border-2 border-black">
              <div className="bg-gray-50 border-b-2 border-black p-3">
                <h2 className="font-mono font-bold">BREX CARD EXPENSES</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-black bg-gray-50">
                    <th className="text-left p-3 font-mono text-sm font-bold">Period</th>
                    <th className="text-right p-3 font-mono text-sm font-bold">Amount</th>
                    <th className="text-right p-3 font-mono text-sm font-bold">Prev Period</th>
                    <th className="text-right p-3 font-mono text-sm font-bold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-3 font-mono text-sm">Last 7 Days</td>
                    <td className="text-right p-3 font-mono text-sm font-bold">{formatMoney(data.brex.expenses7d)}</td>
                    <td className="text-right p-3 font-mono text-sm text-gray-600">{formatMoney(data.brex.expensesPrev7d)}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <ChangeIndicatorInverse change={data.brex.change7d} />
                    </td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="p-3 font-mono text-sm">Last 30 Days</td>
                    <td className="text-right p-3 font-mono text-sm font-bold">{formatMoney(data.brex.expenses30d)}</td>
                    <td className="text-right p-3 font-mono text-sm text-gray-600">{formatMoney(data.brex.expensesPrev30d)}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <ChangeIndicatorInverse change={data.brex.change30d} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Pageviews Table */}
          {data?.pageviews && (
            <div className="border-2 border-black">
              <div className="bg-gray-50 border-b-2 border-black p-3">
                <h2 className="font-mono font-bold">MEDIAR.AI PAGEVIEWS</h2>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-black bg-gray-50">
                    <th className="text-left p-3 font-mono text-sm font-bold">Period</th>
                    <th className="text-right p-3 font-mono text-sm font-bold">Unique Visitors</th>
                    <th className="text-right p-3 font-mono text-sm font-bold">Prev Period</th>
                    <th className="text-right p-3 font-mono text-sm font-bold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="p-3 font-mono text-sm">Last 7 Days</td>
                    <td className="text-right p-3 font-mono text-sm font-bold">{data.pageviews.visitors7d}</td>
                    <td className="text-right p-3 font-mono text-sm text-gray-600">{data.pageviews.visitorsPrev7d}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <ChangeIndicator change={data.pageviews.change7d} />
                    </td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="p-3 font-mono text-sm">Last 30 Days</td>
                    <td className="text-right p-3 font-mono text-sm font-bold">{data.pageviews.visitors30d}</td>
                    <td className="text-right p-3 font-mono text-sm text-gray-600">{data.pageviews.visitorsPrev30d}</td>
                    <td className="text-right p-3 font-mono text-sm">
                      <ChangeIndicator change={data.pageviews.change30d} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
