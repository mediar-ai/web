'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface UserData {
  id: string;
  label: string;
  dailyTokens: number[];
}

interface TokenData {
  dates: string[];
  users: UserData[];
  vertexDailyTokens: number[];
  vertexTotal: number;
  tracedDailyTokens: number[];
  tracedTotal: number;
  error?: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function UserTokensPage() {
  const [data, setData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    console.log('[user-tokens-page] Fetching data...');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/user-tokens');
      if (res.ok) {
        const d = await res.json();
        console.log('[user-tokens-page] Data received:', d);
        setData(d);
      } else {
        const error = await res.json();
        console.error('[user-tokens-page] API error:', error);
        toast.error(error.error || 'Failed to load token data');
        setData({ dates: [], users: [], vertexDailyTokens: [], vertexTotal: 0, tracedDailyTokens: [], tracedTotal: 0, error: error.error });
      }
    } catch (err) {
      console.error('[user-tokens-page] Fetch error:', err);
      toast.error('Failed to fetch token data');
      setData({ dates: [], users: [], vertexDailyTokens: [], vertexTotal: 0, tracedDailyTokens: [], tracedTotal: 0, error: String(err) });
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
            <Users className="w-6 h-6" />
            USER TOKEN CONSUMPTION
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Last 7 days - Vertex AI token usage by user
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
          <p className="font-mono text-gray-600">Loading token data...</p>
        </div>
      ) : !data || data.users.length === 0 ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">No token usage data found for the last 7 days.</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="border-2 border-black p-3">
              <div className="font-mono text-xs text-gray-600 uppercase">Users</div>
              <div className="font-mono font-bold text-xl">{data.users.length}</div>
            </div>
            <div className="border-2 border-black p-3">
              <div className="font-mono text-xs text-gray-600 uppercase">Traced Total</div>
              <div className="font-mono font-bold text-xl">{formatTokens(data.tracedTotal)}</div>
            </div>
            <div className="border-2 border-black p-3">
              <div className="font-mono text-xs text-gray-600 uppercase">Vertex Total</div>
              <div className="font-mono font-bold text-xl">{formatTokens(data.vertexTotal)}</div>
            </div>
            <div className="border-2 border-black p-3">
              <div className="font-mono text-xs text-gray-600 uppercase">Untraced</div>
              <div className="font-mono font-bold text-xl text-orange-600">
                {formatTokens(data.vertexTotal - data.tracedTotal)}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b-2 border-black bg-gray-50">
                  <th className="text-left p-3 font-mono text-sm font-bold sticky left-0 bg-gray-50">
                    User
                  </th>
                  {data.dates.map(date => (
                    <th key={date} className="text-right p-3 font-mono text-sm font-bold min-w-[80px]">
                      {formatDate(date)}
                    </th>
                  ))}
                  <th className="text-right p-3 font-mono text-sm font-bold min-w-[80px] border-l-2 border-black">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => {
                  const total = user.dailyTokens.reduce((sum, t) => sum + t, 0);
                  const maxDaily = Math.max(...user.dailyTokens, 1);

                  return (
                    <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-3 font-mono text-sm sticky left-0 bg-white max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {user.label}
                      </td>
                      {user.dailyTokens.map((tokens, i) => {
                        const intensity = tokens / maxDaily;
                        return (
                          <td
                            key={i}
                            className="text-right p-3 font-mono text-sm"
                            style={{
                              backgroundColor: tokens > 0 ? `rgba(0, 0, 0, ${intensity * 0.1})` : 'transparent',
                            }}
                          >
                            {tokens > 0 ? formatTokens(tokens) : '-'}
                          </td>
                        );
                      })}
                      <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black">
                        {formatTokens(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* Traced Total Row */}
                <tr className="border-t-2 border-black bg-gray-50">
                  <td className="p-3 font-mono text-sm font-bold sticky left-0 bg-gray-50">
                    Traced Total
                  </td>
                  {data.tracedDailyTokens.map((tokens, i) => (
                    <td key={i} className="text-right p-3 font-mono text-sm font-bold">
                      {formatTokens(tokens)}
                    </td>
                  ))}
                  <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black">
                    {formatTokens(data.tracedTotal)}
                  </td>
                </tr>

                {/* Vertex AI Total Row */}
                <tr className="bg-gray-100">
                  <td className="p-3 font-mono text-sm font-bold sticky left-0 bg-gray-100">
                    Vertex AI Total
                  </td>
                  {data.vertexDailyTokens.map((tokens, i) => (
                    <td key={i} className="text-right p-3 font-mono text-sm font-bold text-green-700">
                      {tokens > 0 ? formatTokens(tokens) : '-'}
                    </td>
                  ))}
                  <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black text-green-700">
                    {formatTokens(data.vertexTotal)}
                  </td>
                </tr>

                {/* Untraced Row */}
                <tr className="bg-orange-50">
                  <td className="p-3 font-mono text-sm font-bold sticky left-0 bg-orange-50 text-orange-600">
                    Untraced
                  </td>
                  {data.vertexDailyTokens.map((vertexTokens, i) => {
                    const tracedTokens = data.tracedDailyTokens[i] || 0;
                    const discrepancy = vertexTokens - tracedTokens;
                    return (
                      <td
                        key={i}
                        className={`text-right p-3 font-mono text-sm font-bold ${
                          discrepancy > 0 ? 'text-orange-600' : discrepancy < 0 ? 'text-blue-600' : 'text-gray-400'
                        }`}
                      >
                        {vertexTokens > 0 ? (discrepancy < 0 ? '-' : '') + formatTokens(Math.abs(discrepancy)) : '-'}
                      </td>
                    );
                  })}
                  <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black text-orange-600">
                    {formatTokens(data.vertexTotal - data.tracedTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
