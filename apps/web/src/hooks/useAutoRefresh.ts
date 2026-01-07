'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface UseAutoRefreshOptions {
  /** Polling interval in milliseconds. Default: 30000 (30s) */
  interval?: number;
  /** Whether auto-refresh is enabled by default. Default: true */
  enabled?: boolean;
  /** localStorage key to persist enabled state. Optional. */
  storageKey?: string;
}

interface UseAutoRefreshResult<T> {
  /** The fetched data */
  data: T | null;
  /** Whether initial load or manual refresh is in progress */
  loading: boolean;
  /** Whether background auto-refresh is in progress */
  isRefreshing: boolean;
  /** Whether auto-refresh is enabled */
  autoRefreshEnabled: boolean;
  /** Toggle auto-refresh on/off */
  toggleAutoRefresh: () => void;
  /** Manually trigger a refresh */
  refresh: () => Promise<void>;
  /** Timestamp of last successful fetch */
  lastUpdated: Date | null;
  /** Human-readable "X seconds ago" string */
  lastUpdatedAgo: string;
  /** Error message if fetch failed */
  error: string | null;
}

/**
 * Hook for auto-refreshing data at a configurable interval.
 * Provides pause/resume, last updated timestamp, and loading states.
 */
export function useAutoRefresh<T>(
  fetchFn: () => Promise<T>,
  options: UseAutoRefreshOptions = {}
): UseAutoRefreshResult<T> {
  const { interval = 30000, enabled = true, storageKey } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [lastUpdatedAgo, setLastUpdatedAgo] = useState<string>('');
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === 'true' : enabled;
    }
    return enabled;
  });

  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  const doFetch = useCallback(async (isBackground: boolean) => {
    console.log(`[useAutoRefresh] Fetching... (background: ${isBackground})`);
    if (isBackground) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await fetchFnRef.current();
      setData(result);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error('[useAutoRefresh] Fetch error:', err);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    doFetch(false);
  }, [doFetch]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefreshEnabled) return;

    const timer = setInterval(() => {
      doFetch(true);
    }, interval);

    return () => clearInterval(timer);
  }, [autoRefreshEnabled, interval, doFetch]);

  // Update "X ago" string every second
  useEffect(() => {
    const updateAgo = () => {
      if (!lastUpdated) {
        setLastUpdatedAgo('');
        return;
      }
      const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
      if (seconds < 5) {
        setLastUpdatedAgo('just now');
      } else if (seconds < 60) {
        setLastUpdatedAgo(`${seconds}s ago`);
      } else if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        setLastUpdatedAgo(`${mins}m ago`);
      } else {
        const hours = Math.floor(seconds / 3600);
        setLastUpdatedAgo(`${hours}h ago`);
      }
    };

    updateAgo();
    const timer = setInterval(updateAgo, 1000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  const toggleAutoRefresh = useCallback(() => {
    setAutoRefreshEnabled((prev) => {
      const newValue = !prev;
      if (storageKey) {
        localStorage.setItem(storageKey, String(newValue));
      }
      return newValue;
    });
  }, [storageKey]);

  const refresh = useCallback(async () => {
    await doFetch(false);
  }, [doFetch]);

  return {
    data,
    loading,
    isRefreshing,
    autoRefreshEnabled,
    toggleAutoRefresh,
    refresh,
    lastUpdated,
    lastUpdatedAgo,
    error,
  };
}
