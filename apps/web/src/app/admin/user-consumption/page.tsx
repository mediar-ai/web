'use client';

import { useCallback } from 'react';
import { Activity } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';

interface UserData {
  id: string;
  email: string;
  chat3d: number;
  chat3m: number;
  events3d: number;
  events3m: number;
}

interface ConsumptionData {
  users: UserData[];
  totals: {
    chat3d: number;
    chat3m: number;
    events3d: number;
    events3m: number;
  };
  timestamp: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

const REFRESH_INTERVAL = 60000; // 60 seconds

export default function UserConsumptionPage() {
  const fetchData = useCallback(async (): Promise<ConsumptionData> => {
    console.log('[user-consumption-page] Fetching data...');
    const res = await fetch('/api/admin/user-consumption');
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to load consumption data');
    }
    const d = await res.json();
    console.log('[user-consumption-page] Data received:', d);
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
    storageKey: 'admin-user-consumption-auto-refresh',
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
            <Activity className="w-6 h-6" />
            USER CONSUMPTION
          </h1>
          <p className="font-mono text-sm text-gray-600 mt-1">
            Chat messages and recorded events per user
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
          <p className="font-mono text-gray-600">Loading consumption data...</p>
        </div>
      ) : !data || data.users.length === 0 ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">No consumption data found.</p>
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
              <div className="font-mono text-xs text-gray-600 uppercase">Chat (3 months)</div>
              <div className="font-mono font-bold text-xl">{formatNumber(data.totals.chat3m)}</div>
            </div>
            <div className="border-2 border-black p-3">
              <div className="font-mono text-xs text-gray-600 uppercase">Events (3 months)</div>
              <div className="font-mono font-bold text-xl">{formatNumber(data.totals.events3m)}</div>
            </div>
            <div className="border-2 border-black p-3">
              <div className="font-mono text-xs text-gray-600 uppercase">Total Activity</div>
              <div className="font-mono font-bold text-xl">
                {formatNumber(data.totals.chat3m + data.totals.events3m)}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b-2 border-black bg-black text-white">
                  <th className="text-left p-3 font-mono text-sm font-bold sticky left-0 bg-black">
                    User
                  </th>
                  <th className="text-right p-3 font-mono text-sm font-bold border-l border-gray-600" colSpan={2}>
                    Chat Messages
                  </th>
                  <th className="text-right p-3 font-mono text-sm font-bold border-l border-gray-600" colSpan={2}>
                    Recorded Events
                  </th>
                </tr>
                <tr className="border-b-2 border-black bg-gray-100">
                  <th className="text-left p-2 font-mono text-xs text-gray-600 sticky left-0 bg-gray-100"></th>
                  <th className="text-right p-2 font-mono text-xs text-gray-600 border-l border-gray-300">3 Days</th>
                  <th className="text-right p-2 font-mono text-xs text-gray-600">3 Months</th>
                  <th className="text-right p-2 font-mono text-xs text-gray-600 border-l border-gray-300">3 Days</th>
                  <th className="text-right p-2 font-mono text-xs text-gray-600">3 Months</th>
                </tr>
              </thead>
              <tbody>
                {/* Totals Row */}
                <tr className="border-b-2 border-black bg-gray-100">
                  <td className="p-3 font-mono text-sm font-bold sticky left-0 bg-gray-100">
                    TOTAL ({data.users.length} users)
                  </td>
                  <td className="text-right p-3 font-mono text-sm font-bold border-l border-gray-300">
                    {data.totals.chat3d > 0 ? formatNumber(data.totals.chat3d) : '-'}
                  </td>
                  <td className="text-right p-3 font-mono text-sm font-bold">
                    {data.totals.chat3m > 0 ? formatNumber(data.totals.chat3m) : '-'}
                  </td>
                  <td className="text-right p-3 font-mono text-sm font-bold border-l border-gray-300">
                    {data.totals.events3d > 0 ? formatNumber(data.totals.events3d) : '-'}
                  </td>
                  <td className="text-right p-3 font-mono text-sm font-bold">
                    {data.totals.events3m > 0 ? formatNumber(data.totals.events3m) : '-'}
                  </td>
                </tr>

                {/* User Rows */}
                {data.users.map((user, index) => (
                  <tr
                    key={user.id}
                    className={`border-b border-gray-200 hover:bg-gray-50 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
                  >
                    <td className="p-3 font-mono text-sm sticky left-0 bg-inherit max-w-[250px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {user.email}
                    </td>
                    <td className="text-right p-3 font-mono text-sm border-l border-gray-200">
                      {user.chat3d > 0 ? formatNumber(user.chat3d) : '-'}
                    </td>
                    <td className="text-right p-3 font-mono text-sm">
                      {user.chat3m > 0 ? formatNumber(user.chat3m) : '-'}
                    </td>
                    <td className="text-right p-3 font-mono text-sm border-l border-gray-200">
                      {user.events3d > 0 ? formatNumber(user.events3d) : '-'}
                    </td>
                    <td className="text-right p-3 font-mono text-sm">
                      {user.events3m > 0 ? formatNumber(user.events3m) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
