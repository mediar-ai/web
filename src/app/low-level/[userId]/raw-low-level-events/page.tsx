'use client';

import { useState, useEffect, use, useCallback, useRef, useMemo } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JsonBlock } from '@/components/ui/code-block';
import { ChevronDown, ChevronUp, Clipboard, Check, RefreshCw, ArrowUp, ArrowDown, Database, HardDrive, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { getRawEventsStorage } from '@/lib/rawEventsStorage';

// Helper function to estimate memory usage of events data
const estimateMemoryUsage = (events: LowLevelEvent[]): number => {
  const jsonString = JSON.stringify(events);
  return new Blob([jsonString]).size;
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
  const [hasMoreData, setHasMoreData] = useState(true);
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [autoLoadingComplete, setAutoLoadingComplete] = useState(false);
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [loadAllProgress, setLoadAllProgress] = useState<{ loaded: number; total: number } | null>(null);
  
  const viewClearedRef = useRef(false);
  const storageRef = useRef(getRawEventsStorage(use(params).userId));
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
    return new Date(event.created_at).toLocaleString();
  }, []);

  // Function to load events from IndexedDB for display
  const loadEventsForDisplay = useCallback(async (limit: number = 1000) => {
    try {
      const storedEvents = await storageRef.current.loadEvents(limit);
      if (storedEvents.length > 0) {
        const sortedEvents = storedEvents.sort((a, b) => {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
        });
        setDisplayEvents(sortedEvents);
        setCurrentDisplayLimit(storedEvents.length);
        console.log(`[RawEvents] Loaded ${storedEvents.length} events from IndexedDB for display`);
      }
    } catch (error) {
      console.error('[RawEvents] Failed to load events from IndexedDB:', error);
    }
  }, [sortOrder]);

  // Update memory usage when display events change
  useEffect(() => {
    const usage = estimateMemoryUsage(displayEvents);
    setMemoryUsage(usage);
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
        
        // Load events from IndexedDB on initial load (only if no events loaded yet)
        if (displayEvents.length === 0 && loading) {
          await loadEventsForDisplay(1000);
          
          // Set loading to false since we have cached data
          setLoading(false);
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
        const existingEventIds = new Set(displayEvents.map((e: LowLevelEvent) => e.id));
        const newEvents = sortedEvents.filter((e: LowLevelEvent) => !existingEventIds.has(e.id));
        
        if (newEvents.length > 0) {
          const newIds = new Set<number>(newEvents.map((e: LowLevelEvent) => e.id));
          setNewEventIds(newIds);
          
          // Refresh display from IndexedDB to show new events
          await loadEventsForDisplay(currentDisplayLimit + newEvents.length);
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
      
      setHasMoreData(data.hasMore || false);
      
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
  }, [userId, sortOrder, selectedEventType, displayEvents, currentDisplayLimit, loadEventsForDisplay]);

  // Initial fetch
  useEffect(() => {
    const initialLoad = async () => {
      const result = await fetchRawEvents(INITIAL_CHUNK_SIZE, 0);
      
      // Start auto-loading additional chunks up to the limit
      if (result.hasMore && result.events.length < AUTO_LOAD_LIMIT) {
        autoLoadMore(result.events.length);
      } else {
        setAutoLoadingComplete(true);
      }
    };
    
    initialLoad();
  }, [fetchRawEvents]);

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

  // Live polling every 2 seconds (only poll the first chunk for new events)
  useEffect(() => {
    if (loading) return; // Don't start polling until initial load is complete
    
    const interval = setInterval(() => {
      fetchRawEvents(INITIAL_CHUNK_SIZE, 0, true); // Pass true to indicate this is a polling update
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchRawEvents, loading]);

  // Manual load more function
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMoreData) return;
    
    // Check memory limit before loading more
    const currentMemoryMB = memoryUsage / (1024 * 1024);
    if (currentMemoryMB > MAX_MEMORY_MB) {
      alert(`Memory limit reached (${formatBytes(memoryUsage)}). Please use filters or clear the view to load more data.`);
      return;
    }
    
    await fetchRawEvents(MANUAL_LOAD_CHUNK_SIZE, currentDisplayLimit, false, true);
  }, [fetchRawEvents, currentDisplayLimit, loadingMore, hasMoreData, memoryUsage]);

  // Load all remaining data
  const loadAll = useCallback(async () => {
    if (!totalAvailable || loadAllProgress) return;
    
    const remaining = totalAvailable - displayEvents.length;
    if (remaining <= 0) return;
    
    // Warn user about memory usage
    const estimatedMemoryMB = (memoryUsage * (totalAvailable / displayEvents.length)) / (1024 * 1024);
    if (estimatedMemoryMB > MAX_MEMORY_MB) {
      const confirmed = confirm(
        `Loading all ${totalAvailable.toLocaleString()} events may use ~${estimatedMemoryMB.toFixed(1)}MB of memory. ` +
        `This could slow down your browser. Continue?`
      );
      if (!confirmed) return;
    }
    
    setLoadAllProgress({ loaded: displayEvents.length, total: totalAvailable });
    
    let currentLoadedCount = displayEvents.length;
    const chunkSize = 1000;
    
    while (currentLoadedCount < totalAvailable) {
      const result = await fetchRawEvents(chunkSize, currentLoadedCount, false, true);
      currentLoadedCount += result.events.length;
      
      setLoadAllProgress({ loaded: currentLoadedCount, total: totalAvailable });
      
      if (!result.hasMore) break;
      
      // Small delay to prevent UI blocking
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    setLoadAllProgress(null);
  }, [fetchRawEvents, totalAvailable, displayEvents.length, memoryUsage, loadAllProgress]);

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
    try {
      await storageRef.current.clearAllEvents();
      const info = await storageRef.current.getStorageInfo();
      setStorageInfo(info);
      setDisplayEvents([]);
      setExpandedEvents({});
      setNewEventIds(new Set());
      setCurrentDisplayLimit(0);
      viewClearedRef.current = false; // Reset cleared view flag
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
      console.log('[RawEvents] Cleared IndexedDB storage');
      
      // Trigger a fresh fetch after clearing
      fetchRawEvents(INITIAL_CHUNK_SIZE, 0);
    } catch (error) {
      console.error('[RawEvents] Failed to clear IndexedDB:', error);
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
      <div className="flex items-center gap-2 py-2 border-b mb-2">
        <Clock />
        <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-black rounded-md">
          <span className="text-sm font-medium text-black">
            {displayEvents.length} events loaded
          </span>
          {totalAvailable && (
            <span className="text-xs text-gray-600">
              (of {totalAvailable.toLocaleString()} total)
            </span>
          )}
        </div>

        {storageInfo && (
          <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-md">
            <Database className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">
              {storageInfo.eventCount} cached
            </span>
            <span className="text-xs text-blue-600">
              ({(storageInfo.totalSize / 1024 / 1024).toFixed(1)}MB)
            </span>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-1 bg-green-50 border border-green-200 rounded-md">
          <span className="text-sm font-medium text-green-800">
            Memory: {formatBytes(memoryUsage)}
          </span>
          {memoryUsage > MAX_MEMORY_MB * 1024 * 1024 && (
            <span className="text-xs text-red-600">(High)</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
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
        </div>
        <Button variant="black-outline" size="sm" onClick={toggleSortOrder}>
          {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
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
        
        {/* Progressive loading controls */}
        {hasMoreData && autoLoadingComplete && (
          <Button 
            variant="black-outline" 
            size="sm" 
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? 'Loading...' : 'Load More'}
          </Button>
        )}
        
        {totalAvailable && displayEvents.length < totalAvailable && autoLoadingComplete && (
          <Button 
            variant="black-outline" 
            size="sm" 
            onClick={loadAll}
            disabled={!!loadAllProgress}
            title={`Load all ${(totalAvailable - displayEvents.length).toLocaleString()} remaining events`}
          >
            <Download className="h-4 w-4 mr-1" />
            Load All ({(totalAvailable - displayEvents.length).toLocaleString()})
          </Button>
        )}
      </div>
      
      {/* Load All Progress */}
      {loadAllProgress && (
        <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex justify-between text-sm text-blue-800 mb-2">
            <span>Loading all events...</span>
            <span>{loadAllProgress.loaded.toLocaleString()} / {loadAllProgress.total.toLocaleString()}</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
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

      {loading && events.length === 0 && (
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
    </div>
  );
} 