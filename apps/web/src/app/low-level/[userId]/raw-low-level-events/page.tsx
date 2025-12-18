'use client';

import { TimeBoundarySelector } from '@/components/TimeBoundarySelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JsonBlock } from '@/components/ui/code-block';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from '@/components/ui/input';
import { getRawEventsStorage } from '@/lib/rawEventsStorage';
import { formatDateWithTimezone } from '@/lib/timezoneUtils';
import { type LowLevelEvent } from '@/types';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Calendar, Check, ChevronDown, ChevronUp, Clipboard, Database, Download, HardDrive, RefreshCw } from 'lucide-react';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

// Helper function to estimate memory usage of events data
const estimateMemoryUsage = (events: LowLevelEvent[]): number => {
  // Simple estimation: average ~2KB per event (much faster than JSON.stringify)
  return events.length * 2048; // 2KB per event estimate
};

// Helper function to format bytes
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const Clock = () => {
    const [time, setTime] = useState<Date | null>(null);

    useEffect(() => {
        setTime(new Date());
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    return <div className="text-sm text-gray-500 font-mono w-48 text-right">{time ? `UTC: ${time.toUTCString()}` : ''}</div>;
};

export default function RawLowLevelEventsPage({ params }: { params: Promise<{ userId: string }> }) {
  // UI state only - no events array in React state
  const [displayEvents, setDisplayEvents] = useState<LowLevelEvent[]>([]); // Only for current UI view
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [availableEventTypes, setAvailableEventTypes] = useState<string[]>([]);
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});
  const [copiedEventId, setCopiedEventId] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());
  
  // IndexedDB storage state
  const [storageInfo, setStorageInfo] = useState<{
    totalSize: number;
    eventCount: number;
    maxSize: number;
    usagePercentage: number;
  } | null>(null);
  const [isStorageOpen, setIsStorageOpen] = useState(false);
  
  // Progressive loading state
  const [currentDisplayLimit, setCurrentDisplayLimit] = useState(0);
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [autoLoadingComplete, setAutoLoadingComplete] = useState(false);
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [loadAllProgress, setLoadAllProgress] = useState<{ loaded: number; total: number } | null>(null);
  
  // Time boundary state for loading specific periods
  const [timeBoundary, setTimeBoundary] = useState<{startDate: Date | null; endDate: Date | null}>({
    startDate: null,
    endDate: null
  });
  const [isLoadingPeriod, setIsLoadingPeriod] = useState(false);
  
  // Load More modal state
  const [isLoadMoreModalOpen, setIsLoadMoreModalOpen] = useState(false);
  
  const viewClearedRef = useRef(false);
  const storageRef = useRef(getRawEventsStorage(use(params).userId));
  const displayEventsRef = useRef<LowLevelEvent[]>([]); // Ref to avoid callback dependency cycles
  const { userId } = use(params);

  // Configuration constants
  const INITIAL_CHUNK_SIZE = 100;
  const AUTO_LOAD_CHUNK_SIZE = 100;
  const AUTO_LOAD_LIMIT = 1000; // Auto-load up to 1000 records
  const MANUAL_LOAD_CHUNK_SIZE = 1000;
  const MAX_MEMORY_MB = 50; // Cap at 50MB

  const LOCAL_STORAGE_KEY = `low-level-viewer-expanded-events-${userId}`;
  const SUMMARY_OPEN_STORAGE_KEY = `raw-events-summary-open-${userId}`;
  const SORT_ORDER_STORAGE_KEY = `raw-events-sort-order-${userId}`;

  const getEventType = useCallback((event: LowLevelEvent): string => {
    const payload = event.payload as { payload?: { type?: string } };
    return payload?.payload?.type || 'unknown';
  }, []);

  const getEventTimestamp = useCallback((event: LowLevelEvent): string => {
    return formatDateWithTimezone(event.created_at, { includeSeconds: true });
  }, []);

  // Helper function for incremental UI updates (much more efficient than full reloads)
  const addNewEventsToUI = useCallback((newEvents: LowLevelEvent[]) => {
    if (newEvents.length === 0) return;
    
    console.log(`[RawEvents] Adding ${newEvents.length} new events to UI incrementally`);
    
    // Sort new events by timestamp (desc) to maintain order
    const sortedNewEvents = newEvents.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
    });
    
    // Prepend new events to existing display (newest first for desc sort)
    // Filter out duplicates to prevent React key conflicts
    setDisplayEvents(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      const uniqueNewEvents = sortedNewEvents.filter(e => !existingIds.has(e.id));
      
      if (uniqueNewEvents.length === 0) {
        console.log(`[RawEvents] All ${sortedNewEvents.length} events already exist in display, skipping update`);
        return prev;
      }
      
      console.log(`[RawEvents] Adding ${uniqueNewEvents.length} unique events (filtered ${sortedNewEvents.length - uniqueNewEvents.length} duplicates)`);
      
      // Update display limit based on actually added unique events
      setCurrentDisplayLimit(prevLimit => prevLimit + uniqueNewEvents.length);
      
      if (sortOrder === 'desc') {
        return [...uniqueNewEvents, ...prev];
      } else {
        return [...prev, ...uniqueNewEvents];
      }
    });
    
    // Mark new events for visual indication (only unique ones)
    const newIds = new Set<number>(newEvents.map(e => e.id));
    setNewEventIds(newIds);
  }, [sortOrder]);

  // Function to load events from IndexedDB for display
  const loadEventsForDisplay = useCallback(async (limit: number = 1000) => {
    try {
      console.log(`[RawEvents] Loading ${limit} events from IndexedDB for display`);
      
      // Get all events from IndexedDB for this user
      const allEvents = await storageRef.current.getEventsSortedByAge();
      
      if (allEvents.length === 0) {
        console.log('[RawEvents] No events found in IndexedDB');
        setDisplayEvents([]);
        setCurrentDisplayLimit(0);
        setMemoryUsage(0);
        return;
      }
      
      // Apply sort order 
      const sortedEvents = allEvents.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        });
      
      // Apply limit
      const limitedEvents = sortedEvents.slice(0, limit);
      
      // Update display state
      setDisplayEvents(limitedEvents);
      setCurrentDisplayLimit(limitedEvents.length);
      
      // Update memory usage estimation
      const memUsage = estimateMemoryUsage(limitedEvents);
      setMemoryUsage(memUsage);
      
      console.log(`[RawEvents] Loaded ${limitedEvents.length} events from IndexedDB (${formatBytes(memUsage)} memory)`);
      
    } catch (error) {
      console.error('[RawEvents] Failed to load events from IndexedDB:', error);
      setError('Failed to load events from storage');
    }
  }, [sortOrder]);

  // Load events for a specific time period
  const loadEventsForPeriod = useCallback(async () => {
    if (!timeBoundary.startDate || !timeBoundary.endDate) {
      console.log('[RawEvents] No time boundary set for period loading');
      return;
    }
    
    setIsLoadingPeriod(true);
    setError(null);
    
    try {
      console.log(`[RawEvents] Loading events for period: ${timeBoundary.startDate.toISOString()} to ${timeBoundary.endDate.toISOString()}`);
      
      // Build API URL with date range parameters
      let url = `/api/low-level/${userId}?limit=10000`; // Large limit for period loading
      url += `&startDate=${encodeURIComponent(timeBoundary.startDate.toISOString())}`;
      url += `&endDate=${encodeURIComponent(timeBoundary.endDate.toISOString())}`;
      
      if (selectedEventType && selectedEventType !== 'all') {
        url += `&eventType=${selectedEventType}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch events for time period');
      }
      
      const data = await response.json();
      const sortedEvents = data.events.sort((a: LowLevelEvent, b: LowLevelEvent) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      });
      
      // Update display with period events
      setDisplayEvents(sortedEvents);
      setCurrentDisplayLimit(sortedEvents.length);
      
      // Calculate memory usage
      const memoryUsage = estimateMemoryUsage(sortedEvents);
      setMemoryUsage(memoryUsage);
      
      // Update total available (for this period)
      setTotalAvailable(sortedEvents.length);
      
      console.log(`[RawEvents] Loaded ${sortedEvents.length} events for specified period (${formatBytes(memoryUsage)} memory)`);
      
      // Save to IndexedDB for caching
      if (sortedEvents.length > 0) {
        await storageRef.current.saveEvents(sortedEvents);
        const info = await storageRef.current.getStorageInfo();
        setStorageInfo(info);
      }
      
    } catch (error) {
      console.error('[RawEvents] Failed to load events for period:', error);
      setError(error instanceof Error ? error.message : 'Failed to load events for period');
    } finally {
      setIsLoadingPeriod(false);
    }
  }, [userId, timeBoundary, selectedEventType, sortOrder]);

  // Update memory usage and ref when display events change
  useEffect(() => {
    const usage = estimateMemoryUsage(displayEvents);
    setMemoryUsage(usage);
    displayEventsRef.current = displayEvents; // Keep ref in sync
  }, [displayEvents]);

  useEffect(() => {
    try {
      const storedState = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedState) {
        setExpandedEvents(JSON.parse(storedState));
      } else {
        setExpandedEvents({});
      }
    } catch (error) {
        console.error("Failed to parse expanded events from localStorage", error);
        setExpandedEvents({});
    }
  }, [LOCAL_STORAGE_KEY]);

  useEffect(() => {
    try {
      const storedState = localStorage.getItem(SUMMARY_OPEN_STORAGE_KEY);
      if (storedState !== null) {
        setIsSummaryOpen(JSON.parse(storedState));
      }
    } catch (error) {
        console.error("Failed to parse summary open state from localStorage", error);
        setIsSummaryOpen(false);
    }
  }, [SUMMARY_OPEN_STORAGE_KEY]);

  useEffect(() => {
    try {
      const storedState = localStorage.getItem(SORT_ORDER_STORAGE_KEY);
      if (storedState === 'asc' || storedState === 'desc') {
        setSortOrder(storedState);
      }
    } catch (error) {
      console.error("Failed to parse sort order from localStorage", error);
    }
  }, [SORT_ORDER_STORAGE_KEY]);

  useEffect(() => {
    // When events load, extract the unique event types for the filter dropdown
    if (displayEvents.length > 0) {
      const types = new Set(displayEvents.map(getEventType));
      setAvailableEventTypes(['all', ...Array.from(types)]);
    }
  }, [displayEvents, getEventType]);

  // Note: No longer using previousEventsRef since IndexedDB is single source of truth
  
  // Initialize IndexedDB storage
  useEffect(() => {
    const initStorage = async () => {
      try {
        await storageRef.current.init();
        console.log('[RawEvents] IndexedDB initialized');
        
        // Smart initialization: only load initial data if we have none
        if (displayEvents.length === 0 && loading) {
          // Load a reasonable initial chunk (100 events) instead of 1000
          // IndexedDB persists everything, but UI only shows manageable amount
          await loadEventsForDisplay(100);
          
          // Set loading to false since we have initial data loaded
          setLoading(false);
          console.log('[RawEvents] Loaded initial chunk from IndexedDB');
        }
        
        // Update storage info
        const info = await storageRef.current.getStorageInfo();
        setStorageInfo(info);
      } catch (error) {
        console.error('[RawEvents] Failed to initialize IndexedDB:', error);
      }
    };

    initStorage();
  }, [sortOrder, displayEvents.length, loading, loadEventsForDisplay]);

  // Update storage info periodically
  useEffect(() => {
    const updateStorageInfo = async () => {
      try {
        const info = await storageRef.current.getStorageInfo();
        setStorageInfo(info);
      } catch (error) {
        console.error('[RawEvents] Failed to update storage info:', error);
      }
    };

    const interval = setInterval(updateStorageInfo, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, []);
  
  const fetchRawEvents = useCallback(async (
    limit: number, 
    offset: number = 0, 
    isPollingUpdate = false, 
    isLoadMore = false
  ) => {
    if (!userId) return { events: [], hasMore: false };
    
    if (!isPollingUpdate && !isLoadMore) {
      setLoading(true);
    } else if (isLoadMore) {
      setLoadingMore(true);
    }
    
    setError(null);
    
    try {
      let url = `/api/low-level/${userId}?limit=${limit}&offset=${offset}`;
      if (selectedEventType && selectedEventType !== 'all') {
        url += `&eventType=${selectedEventType}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch raw events');
      }
      
      const data = await response.json();
      const sortedEvents = data.events.sort((a: LowLevelEvent, b: LowLevelEvent) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      });
      
      // Update session count and total available count
      if (data.sessionCount !== undefined) {
        setSessionCount(data.sessionCount);
      }
      if (data.totalEventCount !== undefined) {
        setTotalAvailable(data.totalEventCount);
      }
      
      // Save new events to IndexedDB - single source of truth
      try {
        if (sortedEvents.length > 0) {
          await storageRef.current.saveEvents(sortedEvents);
          console.log(`[RawEvents] Saved ${sortedEvents.length} events to IndexedDB`);
          
          // Update storage info
          const info = await storageRef.current.getStorageInfo();
          setStorageInfo(info);
        }
      } catch (error) {
        console.error('[RawEvents] Failed to save events to IndexedDB:', error);
      }
      
      // Handle polling updates for new events
      if (isPollingUpdate) {
        // NOTE: Smart polling now handles this directly, so we don't need the old refresh logic
        // The expensive loadEventsForDisplay() call has been replaced with direct array updates
        // Use ref to avoid callback dependency on displayEvents (prevents re-render cycles)
        const existingEventIds = new Set(displayEventsRef.current.map((e: LowLevelEvent) => e.id));
        const newEvents = sortedEvents.filter((e: LowLevelEvent) => !existingEventIds.has(e.id));
        
        if (newEvents.length > 0) {
          console.log(`[RawEvents] Fallback polling found ${newEvents.length} new events`);
          
          // For fallback polling (when smart polling isn't used), do incremental update
          addNewEventsToUI(newEvents);
          
          // Update storage info
          const info = await storageRef.current.getStorageInfo();
          setStorageInfo(info);
        }
        
        return { events: newEvents, hasMore: data.hasMore };
      }
      
      // For initial load or load more, refresh the display
      if (isLoadMore) {
        // Increase display limit and reload from IndexedDB
        const newDisplayLimit = currentDisplayLimit + sortedEvents.length;
        setCurrentDisplayLimit(newDisplayLimit);
        await loadEventsForDisplay(newDisplayLimit);
      } else {
        // Initial load - set initial display limit
        setCurrentDisplayLimit(sortedEvents.length);
        await loadEventsForDisplay(sortedEvents.length);
      }
      
      return { events: sortedEvents, hasMore: data.hasMore || false };
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      return { events: [], hasMore: false };
    } finally {
      if (!isPollingUpdate && !isLoadMore) {
        setLoading(false);
      }
      if (isLoadMore) {
        setLoadingMore(false);
      }
    }
  }, [userId, sortOrder, selectedEventType, currentDisplayLimit, loadEventsForDisplay, addNewEventsToUI]);

  // Auto-load more data progressively
  const autoLoadMore = useCallback(async (currentCount: number) => {
    if (currentCount >= AUTO_LOAD_LIMIT) {
      setAutoLoadingComplete(true);
      return;
    }
    
    const nextChunkSize = Math.min(AUTO_LOAD_CHUNK_SIZE, AUTO_LOAD_LIMIT - currentCount);
    const result = await fetchRawEvents(nextChunkSize, currentCount, false, true);
    
    if (result.hasMore && (currentCount + result.events.length) < AUTO_LOAD_LIMIT) {
      // Continue auto-loading with a small delay
      setTimeout(() => autoLoadMore(currentCount + result.events.length), 100);
    } else {
      setAutoLoadingComplete(true);
    }
  }, [fetchRawEvents]);

  // Initial fetch - smart loading that respects IndexedDB
  useEffect(() => {
    const initialLoad = async () => {
      // Wait for IndexedDB initialization to complete first
      await storageRef.current.init();
      
      // Check if we already have data in IndexedDB
      const storageInfo = await storageRef.current.getStorageInfo();
      
      if (storageInfo.eventCount === 0) {
        // No cached data, fetch from API
        console.log('[RawEvents] No cached data, fetching from API');
      const result = await fetchRawEvents(INITIAL_CHUNK_SIZE, 0);
      
      // Start auto-loading additional chunks up to the limit
      if (result.hasMore && result.events.length < AUTO_LOAD_LIMIT) {
        autoLoadMore(result.events.length);
      } else {
        setAutoLoadingComplete(true);
        }
      } else {
        // We have cached data, IndexedDB initialization already loaded initial chunk
        console.log(`[RawEvents] Using cached data (${storageInfo.eventCount} events in IndexedDB)`);
        setAutoLoadingComplete(true);
        
        // Optionally check for new events in background
        setTimeout(() => {
          fetchRawEvents(10, 0, true); // Small background check for new events
        }, 1000);
      }
    };
    
    initialLoad();
  }, [fetchRawEvents, autoLoadMore]);

  // Track latest timestamp for smart polling (persists across renders)
  const latestPollingTimestampRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Update polling timestamp when display events change
  useEffect(() => {
    if (displayEvents.length > 0) {
      const latestEvent = displayEvents[0]; // Events are sorted desc, so first is newest
      const newTimestamp = latestEvent.created_at;
      
      // Only update if we have a newer timestamp
      if (!latestPollingTimestampRef.current || newTimestamp > latestPollingTimestampRef.current) {
        latestPollingTimestampRef.current = newTimestamp;
        console.log(`[RawEvents] Updated polling timestamp to: ${newTimestamp}`);
      }
    }
  }, [displayEvents]);

  // Live polling every 2 seconds (only poll for events newer than latest)
  useEffect(() => {
    if (loading) return; // Don't start polling until initial load is complete
    
    // Clear any existing interval first (prevents duplicates from hot reload)
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    
    console.log('[RawEvents] Starting smart polling...');
    
    pollingIntervalRef.current = setInterval(async () => {
      try {
        // Smart polling: only fetch events newer than our latest timestamp
        if (latestPollingTimestampRef.current) {
          const currentTimestamp = latestPollingTimestampRef.current;
          console.log(`[RawEvents] Polling for events after: ${currentTimestamp}`);
          
          // Fetch only events newer than our latest event
          const response = await fetch(`/api/low-level/${userId}?limit=50&after_timestamp=${encodeURIComponent(currentTimestamp)}`);
          if (!response.ok) {
            console.warn('[RawEvents] Polling failed:', response.statusText);
            return;
          }
          
          const data = await response.json();
          const newEvents = data.events || [];
          
          if (newEvents.length > 0) {
            console.log(`[RawEvents] Found ${newEvents.length} new events via smart polling`);
            
            // Save new events to IndexedDB
            await storageRef.current.saveEvents(newEvents);
            
            // Add new events to display using incremental update
            addNewEventsToUI(newEvents);
            
            // Update storage info
            const info = await storageRef.current.getStorageInfo();
            setStorageInfo(info);
            
            // Update polling timestamp to newest event (CRITICAL FIX!)
            const sortedNewEvents = newEvents.sort((a: LowLevelEvent, b: LowLevelEvent) => {
              return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });
            const newestTimestamp = sortedNewEvents[0].created_at;
            if (newestTimestamp > latestPollingTimestampRef.current) {
              latestPollingTimestampRef.current = newestTimestamp;
              console.log(`[RawEvents] Advanced polling timestamp to: ${newestTimestamp}`);
            }
          } else {
            console.log('[RawEvents] No new events found in polling');
          }
        } else if (displayEvents.length === 0) {
          // Fallback: if no events loaded yet, do minimal fetch to establish baseline
          console.log('[RawEvents] No baseline timestamp, doing fallback fetch');
          fetchRawEvents(10, 0, true);
        } else {
          console.log('[RawEvents] Waiting for initial timestamp to be set');
        }
      } catch (error) {
        console.warn('[RawEvents] Smart polling error:', error);
      }
    }, 2000);

    // Cleanup function that properly clears interval
    return () => {
      console.log('[RawEvents] Cleaning up polling interval');
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [fetchRawEvents, loading, userId, addNewEventsToUI, displayEvents.length]);


  // Manual load more function - loads from IndexedDB cache (much faster!)
  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    
    setLoadingMore(true);
    
    try {
    // Check memory limit before loading more
    const currentMemoryMB = memoryUsage / (1024 * 1024);
    if (currentMemoryMB > MAX_MEMORY_MB) {
      toast.warning(`Memory limit reached (${formatBytes(memoryUsage)}). Please use filters or clear the view to load more data.`);
      return;
    }
    
      const newDisplayLimit = currentDisplayLimit + MANUAL_LOAD_CHUNK_SIZE;
      console.log(`[RawEvents] Loading more events: ${currentDisplayLimit} → ${newDisplayLimit}`);
      
      // Load more events from IndexedDB cache instead of API
      await loadEventsForDisplay(newDisplayLimit);
      
    } catch (error) {
      console.error('[RawEvents] Failed to load more events:', error);
      setError('Failed to load more events');
    } finally {
      setLoadingMore(false);
    }
  }, [loadEventsForDisplay, currentDisplayLimit, loadingMore, memoryUsage]);

  // Load all remaining data (DANGEROUS - includes safety measures)
  const loadAll = useCallback(async () => {
    if (!totalAvailable || loadAllProgress) return;
    
    const remaining = totalAvailable - displayEvents.length;
    if (remaining <= 0) return;
    
    // First, try to load from IndexedDB cache (much safer)
    if (storageInfo && storageInfo.eventCount > displayEvents.length) {
      const cachedAvailable = storageInfo.eventCount;
      const confirmed = confirm(
        `Load all ${cachedAvailable.toLocaleString()} cached events from IndexedDB? ` +
        `This is much faster and safer than downloading from database.`
      );
      
      if (confirmed) {
        try {
          setLoadAllProgress({ loaded: displayEvents.length, total: cachedAvailable });
          await loadEventsForDisplay(cachedAvailable);
          setLoadAllProgress(null);
          return;
        } catch (error) {
          console.error('[RawEvents] Failed to load all cached events:', error);
          setLoadAllProgress(null);
        }
      }
    }
    
    // DANGER ZONE: Loading from API
    const estimatedMemoryMB = remaining * 2048 / (1024 * 1024); // 2KB per event estimate

    if (remaining > 50000) {
      toast.error(
        `[WARN] EXTREME DANGER [WARN]\n\n` +
        `You're trying to load ${remaining.toLocaleString()} events (${estimatedMemoryMB.toFixed(1)}MB).\n` +
        `This WILL crash your browser and could freeze your computer.\n\n` +
        `Consider using filters or Load More instead.`,
        { duration: 10000 }
      );
      return;
    }
    
    if (estimatedMemoryMB > 100) {
      const confirmed = confirm(
        `[WARN] WARNING [WARN]\n\n` +
        `Loading ${remaining.toLocaleString()} events will use ~${estimatedMemoryMB.toFixed(1)}MB of memory.\n` +
        `This could slow down or crash your browser.\n\n` +
        `Are you absolutely sure you want to continue?`
      );
      if (!confirmed) return;
    }
    
    // Proceed with chunked loading from API
    setLoadAllProgress({ loaded: displayEvents.length, total: totalAvailable });
    
    let currentLoadedCount = displayEvents.length;
    const chunkSize = Math.min(1000, remaining); // Limit chunk size
    
    try {
    while (currentLoadedCount < totalAvailable) {
      const result = await fetchRawEvents(chunkSize, currentLoadedCount, false, true);
      currentLoadedCount += result.events.length;
      
      setLoadAllProgress({ loaded: currentLoadedCount, total: totalAvailable });


        // Check memory usage during loading
        const currentMem = estimateMemoryUsage(displayEvents) / (1024 * 1024);
        if (currentMem > MAX_MEMORY_MB) {
          toast.warning(`Memory limit reached (${currentMem.toFixed(1)}MB). Stopping load.`);
          break;
        }
      
      if (!result.hasMore) break;
      
        // Longer delay to prevent browser lockup
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    } catch (error) {
      console.error('[RawEvents] Load all failed:', error);
      setError('Failed to load all events');
    } finally {
    setLoadAllProgress(null);
    }
  }, [fetchRawEvents, loadEventsForDisplay, totalAvailable, displayEvents, loadAllProgress, storageInfo]);

  // Clear new event indicators after 30 seconds
  useEffect(() => {
    if (newEventIds.size > 0) {
      const timer = setTimeout(() => {
        setNewEventIds(new Set());
      }, 30000);

      return () => clearTimeout(timer);
    }
  }, [newEventIds]);

  const toggleSortOrder = () => {
    setSortOrder(prev => {
      const newOrder = prev === 'asc' ? 'desc' : 'asc';
      localStorage.setItem(SORT_ORDER_STORAGE_KEY, newOrder);
      return newOrder;
    });
  };

  const toggleSummary = () => {
    setIsSummaryOpen(prev => {
      const newState = !prev;
      localStorage.setItem(SUMMARY_OPEN_STORAGE_KEY, JSON.stringify(newState));
      return newState;
    });
  };

  const toggleEventExpansion = (eventId: number) => {
    setExpandedEvents(prev => {
      const newState = { ...prev, [eventId]: !prev[eventId] };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newState));
      return newState;
    });
  };

  const handleEventTypeClick = (eventType: string) => {
    setSelectedEventType(prev => (prev === eventType ? null : eventType));
  };

  const handleWindowClick = (windowName: string) => {
    setSelectedWindow(prev => (prev === windowName ? null : windowName));
  };

  // Refresh display when sort order changes
  useEffect(() => {
    if (displayEvents.length > 0) {
      loadEventsForDisplay(currentDisplayLimit);
    }
  }, [sortOrder, loadEventsForDisplay, currentDisplayLimit, displayEvents.length]);

  const handleCopyPayload = (event: LowLevelEvent) => {
    navigator.clipboard.writeText(JSON.stringify(event.payload, null, 2)).then(() => {
      setCopiedEventId(event.id);
      setTimeout(() => setCopiedEventId(null), 2000);
    });
  };

  const handleCopyAllEvents = () => {
    const eventsJson = JSON.stringify(displayEvents, null, 2);
    const blob = new Blob([eventsJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `raw-events-${userId}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const searchedEvents = useMemo(() => {
    if (!searchTerm) return displayEvents;
    const lowercasedFilter = searchTerm.toLowerCase();
    return displayEvents.filter(event => 
      JSON.stringify(event.payload).toLowerCase().includes(lowercasedFilter)
    );
  }, [displayEvents, searchTerm]);

  const eventTypeFilteredEvents = useMemo(() => {
    if (!selectedEventType) return searchedEvents;
    return searchedEvents.filter(event => {
      const body = event.payload as Record<string, unknown>;
      const eventType = (body.payload as Record<string, unknown>)?.type as string || 'unknown';
      return eventType === selectedEventType;
    });
  }, [searchedEvents, selectedEventType]);

  const filteredEvents = useMemo(() => {
    if (!selectedWindow) return eventTypeFilteredEvents;
    return eventTypeFilteredEvents.filter(event => {
      try {
        const body = event.payload as Record<string, unknown>;
        const uiTreeStr = ((body.payload as Record<string, unknown>)?.event as Record<string, unknown>)?.screen as { ui_tree?: string } | undefined;
        if (uiTreeStr?.ui_tree) {
          const uiTree = JSON.parse(uiTreeStr.ui_tree);
          if (uiTree.attributes?.name) {
            return uiTree.attributes.name === selectedWindow;
          }
        }
      } catch {}
      return false;
    });
  }, [eventTypeFilteredEvents, selectedWindow]);

  const expandAll = () => {
    const allExpanded = filteredEvents.reduce((acc, event) => {
        acc[event.id] = true;
        return acc;
    }, {} as Record<number, boolean>);
    setExpandedEvents(allExpanded);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(allExpanded));
  };

  const collapseAll = () => {
      setExpandedEvents({});
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
  };

  const clearView = () => {
    setDisplayEvents([]);
    setExpandedEvents({});
    setNewEventIds(new Set());
    setCurrentDisplayLimit(0);
    viewClearedRef.current = true;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
  };

  const clearIndexedDB = async () => {
    const confirmed = confirm(
      '[WARN] Clear IndexedDB Storage\n\n' +
      'This will completely delete all cached events and metadata from this browser.\n' +
      'This is useful for fixing corrupted data or transaction errors.\n\n' +
      'Continue?'
    );
    
    if (!confirmed) return;

    try {
      console.log('[RawEvents] Starting IndexedDB clear...');
      
      // Use the more robust clearAll method that handles cross-tab scenarios
      await storageRef.current.clearAll();
      
      // Reset all UI state
      setDisplayEvents([]);
      setExpandedEvents({});
      setNewEventIds(new Set());
      setCurrentDisplayLimit(0);
      setMemoryUsage(0);
      viewClearedRef.current = false;
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
      
      // Update storage info (should show 0 now)
      const info = await storageRef.current.getStorageInfo();
      setStorageInfo(info);

      console.log('[RawEvents] [SUCCESS] Successfully cleared IndexedDB storage');
      toast.success('IndexedDB storage cleared successfully! Fresh data will be loaded automatically.');

      // Trigger a fresh fetch after clearing
      await fetchRawEvents(INITIAL_CHUNK_SIZE, 0);
      
    } catch (error) {
      console.error('[RawEvents] [ERROR] Failed to clear IndexedDB:', error);
      toast.error(
        'Failed to clear IndexedDB storage. ' +
        'Error: ' + (error instanceof Error ? error.message : String(error)) + '. ' +
        'Try refreshing the page or closing other tabs with this app open.',
        { duration: 8000 }
      );
    }
  };

  const eventStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const event of searchedEvents) {
      const body = event.payload as Record<string, unknown>;
      const eventType = (body.payload as Record<string, unknown>)?.type as string || 'unknown';
      stats.set(eventType, (stats.get(eventType) || 0) + 1);
    }
    return Array.from(stats.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [searchedEvents]);

  const seenWindows = useMemo(() => {
    const windows = new Set<string>();
    for (const event of searchedEvents) {
      try {
        const body = event.payload as Record<string, unknown>;
        const uiTreeStr = ((body.payload as Record<string, unknown>)?.event as Record<string, unknown>)?.screen as { ui_tree?: string } | undefined;
        if (uiTreeStr?.ui_tree) {
          const uiTree = JSON.parse(uiTreeStr.ui_tree);
          if (uiTree.attributes?.name) {
            windows.add(uiTree.attributes.name);
          }
        }
      } catch {}
    }
    return Array.from(windows).sort();
  }, [searchedEvents]);

  const clientIdentity = useMemo(() => {
    const firstEventWithIdentity = filteredEvents.find(e => {
        const payload = e.payload as { client_identity?: unknown };
        return payload && typeof payload === 'object' && 'client_identity' in payload;
    });
    if (firstEventWithIdentity) {
        return (firstEventWithIdentity.payload as unknown as { client_identity: Record<string, unknown> }).client_identity;
    }
    return null;
  }, [filteredEvents]);

  return (
    <div>
      <div className="space-y-3 py-2 border-b mb-2">
        {/* Line 1: Clock and Core Stats */}
        <div className="flex items-center gap-3">
        <Clock />
        <div className="flex items-center gap-2 px-3 py-1 border border-black rounded-md">
          <span className="text-sm font-medium">
            {displayEvents.length} events loaded
          </span>
            <span className="text-xs text-muted-foreground">
              ({formatBytes(memoryUsage)})
            </span>
          {totalAvailable && (
            <span className="text-xs text-muted-foreground">
              (of {totalAvailable.toLocaleString()} total)
            </span>
          )}
            {memoryUsage > MAX_MEMORY_MB * 1024 * 1024 && (
              <span className="text-xs text-red-600">(High Memory)</span>
            )}
        </div>

        {storageInfo && (
          <div className="flex items-center gap-2 px-3 py-1 border border-black rounded-md">
            <Database className="h-4 w-4" />
            <span className="text-sm font-medium">
              {storageInfo.eventCount} cached
            </span>
            <span className="text-xs text-muted-foreground">
              ({(storageInfo.totalSize / 1024 / 1024).toFixed(1)}MB)
            </span>
          </div>
          )}
        </div>

        {/* Line 2: Search and Filters */}
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64 border-black"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="black-outline">
                Filter by Event Type: {selectedEventType || 'all'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Event Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={selectedEventType || 'all'} onValueChange={setSelectedEventType}>
                {availableEventTypes.map(type => (
                  <DropdownMenuRadioItem key={type} value={type}>
                    {type}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        <Button variant="black-outline" size="sm" onClick={toggleSortOrder}>
          {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
        </div>

        {/* Line 3: Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            variant="black-outline" 
            size="sm" 
            onClick={() => setIsLoadMoreModalOpen(true)}
            disabled={loading}
          >
            <Download className="h-4 w-4 mr-1" />
            Load More
          </Button>
        <Button variant="black-outline" size="sm" onClick={expandAll}>Expand All</Button>
        <Button variant="black-outline" size="sm" onClick={collapseAll}>Collapse All</Button>
        <Button variant="black-outline" size="sm" onClick={clearView}>Clear View</Button>
        <Button variant="black-outline" size="sm" onClick={clearIndexedDB} title="Clear IndexedDB storage">
          <Database className="h-4 w-4" />
        </Button>
        <Button variant="black-outline" size="sm" onClick={() => setIsStorageOpen(!isStorageOpen)} title="Storage info">
          <HardDrive className="h-4 w-4" />
        </Button>
        <Button variant="black-outline" size="sm" onClick={handleCopyAllEvents} disabled={displayEvents.length === 0}>
          Copy All as JSON
        </Button>
        
        </div>
      </div>
      
      {/* Load All Progress */}
      {loadAllProgress && (
        <div className="mb-2 p-3 border border-black rounded-md">
          <div className="flex justify-between text-sm mb-2">
            <span>Loading all events...</span>
            <span>{loadAllProgress.loaded.toLocaleString()} / {loadAllProgress.total.toLocaleString()}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
                              className="bg-black h-2 rounded-full transition-all duration-300"
              style={{ width: `${(loadAllProgress.loaded / loadAllProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      
      {displayEvents.length > 0 && (
        <Card className="mb-2">
            <CardHeader className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer" onClick={toggleSummary}>
                <CardTitle className="text-sm">Event Summary</CardTitle>
                {isSummaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CardHeader>
            <AnimatePresence>
                {isSummaryOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
            <CardContent className="p-2 space-y-2">
                <div>
                    <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">Sessions: {sessionCount}</Badge>
                        {totalAvailable && (
                          <Badge variant="outline">Total Available: {totalAvailable.toLocaleString()}</Badge>
                        )}
                        <Badge variant="outline">Memory: {formatBytes(memoryUsage)}</Badge>
                    </div>
                    {eventStats.length > 0 && (
                        <div className="mt-2">
                            <h4 className="text-xs font-semibold mb-1">Event Types:</h4>
                            <div className="flex flex-wrap gap-1">
                                {eventStats.map(([type, count]) => (
                                    <Badge 
                                        key={type} 
                                        variant={selectedEventType === type ? "default" : "secondary"}
                                        onClick={() => handleEventTypeClick(type)}
                                        className="cursor-pointer"
                                    >
                                        {type}: {count}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    )}
                {seenWindows.length > 0 && (
                        <div className="mt-2">
                            <h4 className="text-xs font-semibold mb-1">Windows:</h4>
                            <div className="flex flex-wrap gap-1">
                                {seenWindows.map((window) => (
                                <Badge
                                        key={window} 
                                        variant={selectedWindow === window ? "default" : "secondary"}
                                        onClick={() => handleWindowClick(window)}
                                        className="cursor-pointer"
                                >
                                        {window}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
                {clientIdentity && (
                        <div className="mt-2">
                            <h4 className="text-xs font-semibold mb-1">Client Identity:</h4>
                            <JsonBlock
                                data={clientIdentity}
                                theme="light"
                                size="sm"
                                showCopy={false}
                                maxHeight="150px"
                            />
                        </div>
                    )}
                    </div>
            </CardContent>
            </motion.div>
                )}
            </AnimatePresence>
        </Card>
      )}

      {storageInfo && (
        <Card className="mb-2">
          <CardHeader className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer" onClick={() => setIsStorageOpen(!isStorageOpen)}>
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="h-4 w-4" />
              IndexedDB Storage
            </CardTitle>
            {isStorageOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </CardHeader>
          <AnimatePresence>
            {isStorageOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <CardContent className="p-2 space-y-2">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-gray-600">Stored Events:</div>
                      <div className="font-medium">{storageInfo.eventCount.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Storage Used:</div>
                      <div className="font-medium">{(storageInfo.totalSize / 1024 / 1024).toFixed(2)} MB</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Storage Limit:</div>
                      <div className="font-medium">{(storageInfo.maxSize / 1024 / 1024).toFixed(0)} MB</div>
                    </div>
                    <div>
                      <div className="text-gray-600">Usage:</div>
                      <div className="font-medium">{storageInfo.usagePercentage.toFixed(1)}%</div>
                    </div>
                  </div>
                  
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span>Storage Usage</span>
                      <span>{storageInfo.usagePercentage.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-300 ${
                          storageInfo.usagePercentage > 90 ? 'bg-red-500' :
                          storageInfo.usagePercentage > 70 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(storageInfo.usagePercentage, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-gray-200">
                    <p className="text-xs text-gray-600">
                      Events are automatically cached for offline access. 
                      Oldest events are removed when storage reaches 90% capacity.
                    </p>
                  </div>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {loading && displayEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground mt-4">Loading Events...</p>
        </div>
      )}

      {error && <div className="text-red-500 font-bold p-2 bg-red-50 rounded-md">Error: {error}</div>}

      {!loading && !error && filteredEvents.length === 0 && (
        <p>
            {displayEvents.length > 0 ? "No events match your search." : "No low-level events found for this user."}
        </p>
      )}

      <div className="space-y-1">
        {filteredEvents.map((event) => {
          const isExpanded = expandedEvents[event.id] || false;
          const eventType = getEventType(event);
          const timestamp = getEventTimestamp(event);
          const isNew = newEventIds.has(event.id);
          
          return (
          <Card 
            key={event.id} 
            className={`transition-all duration-300 ${
              isNew ? 'border-l-4 border-l-black' : ''
            }`}
          >
            <CardHeader 
              className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer"
              onClick={() => toggleEventExpansion(event.id)}
            >
              <div className="text-sm font-medium pr-4 whitespace-normal flex items-center gap-2">
                <Badge variant="outline" className="shrink-0">
                  {eventType}
                </Badge>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{timestamp}</span>
                  {isNew && (
                    <>
                      <Badge variant="outline" className="text-xs bg-black text-white border-black">
                        NEW
                      </Badge>
                      <span className="text-xs text-black font-medium">
                        ({Math.floor((Date.now() - new Date(event.created_at).getTime()) / 1000)}s ago)
                </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <CardContent className="p-0 relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyPayload(event);
                      }}
                    >
                      {copiedEventId === event.id ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Clipboard className="h-4 w-4" />
                      )}
                    </Button>
                    <JsonBlock
                      data={event.payload}
                      theme="light"
                      size="sm"
                      showCopy={true}
                      maxHeight="300px"
                    />
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        )})}
      </div>

      {/* Loading more indicator */}
      {loadingMore && (
        <div className="flex justify-center pt-4">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">Loading more events...</span>
        </div>
      )}

      {/* Load More Modal */}
      <Dialog open={isLoadMoreModalOpen} onOpenChange={setIsLoadMoreModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Load More Events</DialogTitle>
            <DialogDescription>
              Choose how you want to load additional events
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Load More from Cache Option */}
            {storageInfo && storageInfo.eventCount > displayEvents.length && autoLoadingComplete && (
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Load More from Cache</h3>
                    <p className="text-sm text-muted-foreground">
                      Load {Math.min(MANUAL_LOAD_CHUNK_SIZE, storageInfo.eventCount - displayEvents.length)} more events from cached data (fast)
                    </p>
                  </div>
                  <Button 
                    variant="black-outline"
                    onClick={() => {
                      loadMore();
                      setIsLoadMoreModalOpen(false);
                    }}
                    disabled={loadingMore}
                  >
                    {loadingMore ? 'Loading...' : `Load ${Math.min(MANUAL_LOAD_CHUNK_SIZE, storageInfo.eventCount - displayEvents.length)} Events`}
                  </Button>
                </div>
              </Card>
            )}

            {/* Load All Option */}
            {totalAvailable && displayEvents.length < totalAvailable && autoLoadingComplete && (
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Load All Events</h3>
                    <p className="text-sm text-muted-foreground">
                      Load all {(totalAvailable - displayEvents.length).toLocaleString()} remaining events (may be slow)
                    </p>
                  </div>
                  <Button 
                    variant="black-outline"
                    onClick={() => {
                      loadAll();
                      setIsLoadMoreModalOpen(false);
                    }}
                    disabled={!!loadAllProgress}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Load All ({(totalAvailable - displayEvents.length).toLocaleString()})
                  </Button>
                </div>
              </Card>
            )}

            {/* Load by Period Option */}
            <Card className="p-4">
              <div className="space-y-3">
                <div>
                  <h3 className="font-medium">Load by Time Period</h3>
                  <p className="text-sm text-muted-foreground">
                    Load events from a specific time range (up to 10,000 events)
                  </p>
                </div>
                <TimeBoundarySelector
                  selectedBoundary={timeBoundary}
                  onBoundaryChange={setTimeBoundary}
                  disabled={loading || isLoadingPeriod}
                  userId={userId}
                />
                <div className="flex justify-end">
                  <Button 
                    variant="black-outline"
                    onClick={() => {
                      loadEventsForPeriod();
                      setIsLoadMoreModalOpen(false);
                    }}
                    disabled={!timeBoundary.startDate || !timeBoundary.endDate || isLoadingPeriod}
                  >
                    {isLoadingPeriod ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                        Loading Period...
                      </>
                    ) : (
                      <>
                        <Calendar className="h-4 w-4 mr-1" />
                        Load for Period
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
} 