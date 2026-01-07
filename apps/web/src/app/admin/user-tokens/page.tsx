'use client';

import { useCallback } from 'react';
import { Users } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';

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

const REFRESH_INTERVAL = 60000; // 60 seconds for token data

export default function UserTokensPage() {
  const fetchData = useCallback(async (): Promise<TokenData> => {
    console.log('[user-tokens-page] Fetching data...');
    const res = await fetch('/api/admin/user-tokens');
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to load token data');
    }
    const d = await res.json();
    console.log('[user-tokens-page] Data received:', d);
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
    storageKey: 'admin-user-tokens-auto-refresh',
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
            Last 3 days - Vertex AI token usage by user
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

          {/* Table - Total first, then last 3 days (most recent first) */}
          <div className="border-2 border-black overflow-x-auto">
            {(() => {
              // Get last 3 days, reversed (most recent first)
              const last3Dates = data.dates.slice(-3).reverse();
              const dateIndices = last3Dates.map(d => data.dates.indexOf(d));
              console.log('[user-tokens-page] Showing dates:', last3Dates);

              return (
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b-2 border-black bg-gray-50">
                      <th className="text-left p-3 font-mono text-sm font-bold sticky left-0 bg-gray-50">
                        User
                      </th>
                      <th className="text-right p-3 font-mono text-sm font-bold min-w-[80px] border-l-2 border-black">
                        Total
                      </th>
                      {last3Dates.map(date => (
                        <th key={date} className="text-right p-3 font-mono text-sm font-bold min-w-[80px]">
                          {formatDate(date)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => {
                      const total = user.dailyTokens.reduce((sum, t) => sum + t, 0);
                      const last3Tokens = dateIndices.map(i => user.dailyTokens[i] || 0);
                      const maxDaily = Math.max(...last3Tokens, 1);

                      return (
                        <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="p-3 font-mono text-sm sticky left-0 bg-white max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
                            {user.label}
                          </td>
                          <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black">
                            {formatTokens(total)}
                          </td>
                          {last3Tokens.map((tokens, i) => {
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
                      <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black">
                        {formatTokens(data.tracedTotal)}
                      </td>
                      {dateIndices.map((idx, i) => (
                        <td key={i} className="text-right p-3 font-mono text-sm font-bold">
                          {formatTokens(data.tracedDailyTokens[idx] || 0)}
                        </td>
                      ))}
                    </tr>

                    {/* Vertex AI Total Row */}
                    <tr className="bg-gray-100">
                      <td className="p-3 font-mono text-sm font-bold sticky left-0 bg-gray-100">
                        Vertex AI Total
                      </td>
                      <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black text-green-700">
                        {formatTokens(data.vertexTotal)}
                      </td>
                      {dateIndices.map((idx, i) => {
                        const tokens = data.vertexDailyTokens[idx] || 0;
                        return (
                          <td key={i} className="text-right p-3 font-mono text-sm font-bold text-green-700">
                            {tokens > 0 ? formatTokens(tokens) : '-'}
                          </td>
                        );
                      })}
                    </tr>

                    {/* Untraced Row */}
                    <tr className="bg-orange-50">
                      <td className="p-3 font-mono text-sm font-bold sticky left-0 bg-orange-50 text-orange-600">
                        Untraced
                      </td>
                      <td className="text-right p-3 font-mono text-sm font-bold border-l-2 border-black text-orange-600">
                        {formatTokens(data.vertexTotal - data.tracedTotal)}
                      </td>
                      {dateIndices.map((idx, i) => {
                        const vertexTokens = data.vertexDailyTokens[idx] || 0;
                        const tracedTokens = data.tracedDailyTokens[idx] || 0;
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
                    </tr>
                  </tfoot>
                </table>
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}
