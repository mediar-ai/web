'use client';

import { useCallback, useState, useMemo, useEffect } from 'react';
import { Activity, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp, TrendingDown } from 'lucide-react';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshControls } from '@/components/admin/AutoRefreshControls';
import { fetchJson } from '@/lib/fetch-utils';

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

interface WeeklyDataPoint {
  week: string;
  weekLabel: string;
  count: number;
  change: number | null;
}

interface WeeklyData {
  weeks: WeeklyDataPoint[];
  timestamp: string;
}

type SortField = 'email' | 'chat3d' | 'chat3m' | 'events3d' | 'events3m';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

// Line chart component
function WeeklyMessageChart({ weeks }: { weeks: WeeklyDataPoint[] }) {
  if (weeks.length === 0) return null;

  // Filter to only show weeks with data (non-zero counts or last 8 weeks)
  const recentWeeks = weeks.slice(-8);

  const width = 900;
  const height = 200;
  const padding = { top: 40, right: 40, bottom: 20, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const maxCount = Math.max(...recentWeeks.map(w => w.count), 1);
  const minCount = 0; // Start from 0 for better visualization

  // Calculate points for the line
  const points = recentWeeks.map((week, i) => {
    const x = padding.left + (i / (recentWeeks.length - 1 || 1)) * chartWidth;
    const y = padding.top + chartHeight - ((week.count - minCount) / (maxCount - minCount || 1)) * chartHeight;
    return { x, y, ...week };
  });

  // Create path for the line
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Create area path (fill under the line)
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

  // Y-axis labels (0, mid, max)
  const yLabels = [0, Math.round(maxCount / 2), maxCount];

  // Last week's change for header
  const lastWeek = recentWeeks[recentWeeks.length - 1];
  const lastChange = lastWeek?.change;

  return (
    <div className="border-2 border-black mb-6">
      <div className="bg-gray-100 border-b-2 border-black px-3 py-2 flex items-center justify-between">
        <h2 className="font-mono font-bold text-sm uppercase">Weekly Chat Messages (External Users)</h2>
        {lastChange !== null && (
          <div className="flex items-center gap-2">
            <span className={`font-mono text-sm px-2 py-0.5 flex items-center gap-1 ${
              lastChange >= 0 ? 'bg-black text-white' : 'bg-gray-200 text-black'
            }`}>
              {lastChange >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {lastChange >= 0 ? '+' : ''}{lastChange}% vs prev week
            </span>
          </div>
        )}
      </div>
      <div className="p-4 overflow-x-auto">
        <svg width={width} height={height} className="font-mono">
          {/* Grid lines */}
          {yLabels.map((label, i) => {
            const y = padding.top + chartHeight - (i / 2) * chartHeight;
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeDasharray="4,4"
                />
                <text
                  x={padding.left - 8}
                  y={y}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  className="text-xs fill-gray-500"
                >
                  {formatNumber(label)}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path d={areaPath} fill="rgba(0,0,0,0.05)" />

          {/* Line */}
          <path d={linePath} fill="none" stroke="black" strokeWidth="2" />

          {/* Data points */}
          {points.map((point, i) => (
            <g key={i}>
              <circle cx={point.x} cy={point.y} r="5" fill="white" stroke="black" strokeWidth="2" />
              {/* Count label above point with percentage in brackets */}
              <text
                x={point.x}
                y={point.y - 20}
                textAnchor="middle"
                className="text-xs fill-black font-bold"
              >
                {formatNumber(point.count)}
              </text>
              {point.change !== null && (
                <text
                  x={point.x}
                  y={point.y - 8}
                  textAnchor="middle"
                  className={`text-[10px] ${point.change >= 0 ? 'fill-black' : 'fill-gray-500'}`}
                >
                  ({point.change >= 0 ? '+' : ''}{point.change}%)
                </text>
              )}
            </g>
          ))}
        </svg>

        {/* X-axis labels as horizontal wrapped text */}
        <div className="flex justify-between mt-2" style={{ marginLeft: padding.left, marginRight: padding.right }}>
          {recentWeeks.map((week) => (
            <div key={week.week} className="text-center flex-1">
              <div className="font-mono text-[10px] text-gray-600 leading-tight">
                {week.weekLabel.split(' - ').map((part, i) => (
                  <div key={i}>{part}{i === 0 ? ' -' : ''}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const REFRESH_INTERVAL = 60000; // 60 seconds

export default function UserStatsPage() {
  // Default sort: chat messages (3 days) descending (big to small)
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    field: 'chat3d',
    direction: 'desc',
  });

  // Weekly data state
  const [weeklyData, setWeeklyData] = useState<WeeklyData | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(true);

  // Fetch weekly data
  useEffect(() => {
    async function loadWeeklyData() {
      try {
        const data = await fetchJson<WeeklyData>('/api/admin/user-consumption-weekly');
        setWeeklyData(data);
      } catch (err) {
        console.error('Failed to load weekly data:', err);
      } finally {
        setWeeklyLoading(false);
      }
    }
    loadWeeklyData();
  }, []);

  const fetchData = useCallback(async (): Promise<ConsumptionData> => {
    console.log('[user-stats-page] Fetching data...');
    const d = await fetchJson<ConsumptionData>('/api/admin/user-consumption');

    console.log('[user-stats-page] Data received:', d);
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
    storageKey: 'admin-user-stats-auto-refresh',
  });

  // Sort users based on current sort configuration
  const sortedUsers = useMemo(() => {
    if (!data?.users) return [];

    return [...data.users].sort((a, b) => {
      let aValue: number | string;
      let bValue: number | string;

      switch (sortConfig.field) {
        case 'email':
          aValue = a.email.toLowerCase();
          bValue = b.email.toLowerCase();
          break;
        case 'chat3d':
          aValue = a.chat3d;
          bValue = b.chat3d;
          break;
        case 'chat3m':
          aValue = a.chat3m;
          bValue = b.chat3m;
          break;
        case 'events3d':
          aValue = a.events3d;
          bValue = b.events3d;
          break;
        case 'events3m':
          aValue = a.events3m;
          bValue = b.events3m;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data?.users, sortConfig]);

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    setSortConfig(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  // Render sort indicator
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    }
    return sortConfig.direction === 'desc' ? (
      <ArrowDown className="w-3 h-3 ml-1" />
    ) : (
      <ArrowUp className="w-3 h-3 ml-1" />
    );
  };

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
            USER STATS
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

      {/* Weekly Chart */}
      {weeklyLoading ? (
        <div className="border-2 border-black p-6 mb-6">
          <p className="font-mono text-gray-600">Loading weekly trend...</p>
        </div>
      ) : weeklyData && weeklyData.weeks.length > 0 ? (
        <WeeklyMessageChart weeks={weeklyData.weeks} />
      ) : null}

      {loading && !data ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">Loading stats data...</p>
        </div>
      ) : !data || data.users.length === 0 ? (
        <div className="border-2 border-black p-6">
          <p className="font-mono text-gray-600">No stats data found.</p>
        </div>
      ) : (
        <>
          <div className="border-2 border-black overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b-2 border-black bg-black text-white">
                  <th
                    className="text-left p-3 font-mono text-sm font-bold sticky left-0 bg-black cursor-pointer hover:bg-gray-800 transition-colors"
                    onClick={() => handleSort('email')}
                  >
                    <div className="flex items-center">
                      User
                      <SortIndicator field="email" />
                    </div>
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
                  <th
                    className="text-right p-2 font-mono text-xs text-gray-600 border-l border-gray-300 cursor-pointer hover:bg-gray-200 transition-colors"
                    onClick={() => handleSort('chat3d')}
                  >
                    <div className="flex items-center justify-end">
                      3 Days
                      <SortIndicator field="chat3d" />
                    </div>
                  </th>
                  <th
                    className="text-right p-2 font-mono text-xs text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors"
                    onClick={() => handleSort('chat3m')}
                  >
                    <div className="flex items-center justify-end">
                      3 Months
                      <SortIndicator field="chat3m" />
                    </div>
                  </th>
                  <th
                    className="text-right p-2 font-mono text-xs text-gray-600 border-l border-gray-300 cursor-pointer hover:bg-gray-200 transition-colors"
                    onClick={() => handleSort('events3d')}
                  >
                    <div className="flex items-center justify-end">
                      3 Days
                      <SortIndicator field="events3d" />
                    </div>
                  </th>
                  <th
                    className="text-right p-2 font-mono text-xs text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors"
                    onClick={() => handleSort('events3m')}
                  >
                    <div className="flex items-center justify-end">
                      3 Months
                      <SortIndicator field="events3m" />
                    </div>
                  </th>
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
                {sortedUsers.map((user, index) => (
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
