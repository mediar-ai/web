'use client';

import { RefreshCw, Pause, Play } from 'lucide-react';

interface AutoRefreshControlsProps {
  loading: boolean;
  isRefreshing: boolean;
  autoRefreshEnabled: boolean;
  lastUpdatedAgo: string;
  intervalSeconds: number;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
}

export function AutoRefreshControls({
  loading,
  isRefreshing,
  autoRefreshEnabled,
  lastUpdatedAgo,
  intervalSeconds,
  onRefresh,
  onToggleAutoRefresh,
}: AutoRefreshControlsProps) {
  return (
    <div className="flex items-center gap-3">
      {/* Last updated + auto-refresh indicator */}
      <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
        {lastUpdatedAgo && (
          <span>
            Updated {lastUpdatedAgo}
          </span>
        )}
        {autoRefreshEnabled && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${isRefreshing ? 'bg-black animate-ping' : 'bg-gray-400'}`} />
            <span className="text-gray-400">({intervalSeconds}s)</span>
          </span>
        )}
      </div>

      {/* Toggle auto-refresh */}
      <button
        onClick={onToggleAutoRefresh}
        className={`p-1.5 border transition-colors ${
          autoRefreshEnabled
            ? 'border-black bg-black text-white hover:bg-gray-800'
            : 'border-gray-300 text-gray-400 hover:border-black hover:text-black'
        }`}
        title={autoRefreshEnabled ? 'Pause auto-refresh' : 'Enable auto-refresh'}
      >
        {autoRefreshEnabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>

      {/* Manual refresh */}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="p-2 border-2 border-black hover:bg-black hover:text-white transition-colors disabled:opacity-50"
        title="Refresh now"
      >
        <RefreshCw className={`w-4 h-4 ${loading || isRefreshing ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
