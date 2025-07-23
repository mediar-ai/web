'use client';

import { useState, useEffect, use, useCallback, useRef, useMemo } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JsonBlock } from '@/components/ui/code-block';
import { ChevronDown, ChevronUp, Clipboard, Check, RefreshCw, ArrowUp, ArrowDown, Download } from 'lucide-react';
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
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
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
  
  // Progressive loading state
  const [currentOffset, setCurrentOffset] = useState(0);
  const [hasMoreData, setHasMoreData] = useState(true);
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [autoLoadingComplete, setAutoLoadingComplete] = useState(false);
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [loadAllProgress, setLoadAllProgress] = useState<{ loaded: number; total: number } | null>(null);
  
  const viewClearedRef = useRef(false);
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
    if (events.length > 0) {
      const types = new Set(events.map(getEventType));
      setAvailableEventTypes(['all', ...Array.from(types)]);
    }
  }, [events, getEventType]);

  // Use ref to store previous events for comparison during polling
  const previousEventsRef = useRef<LowLevelEvent[]>([]);
  
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
      
      // Handle polling updates for new events
      if (isPollingUpdate && previousEventsRef.current.length > 0) {
        const existingEventIds = new Set(previousEventsRef.current.map((e: LowLevelEvent) => e.id));
        const newEvents = sortedEvents.filter((e: LowLevelEvent) => !existingEventIds.has(e.id));
        
        if (newEvents.length > 0) {
          const newIds = new Set<number>(newEvents.map((e: LowLevelEvent) => e.id));
          setNewEventIds(newIds);
          
          if (viewClearedRef.current) {
            setEvents(prevEvents => {
              const combined = [...newEvents, ...prevEvents];
              return combined.sort((a: LowLevelEvent, b: LowLevelEvent) => {
                const dateA = new Date(a.created_at).getTime();
                const dateB = new Date(b.created_at).getTime();
                return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
              });
            });
            previousEventsRef.current = [...newEvents, ...previousEventsRef.current];
            return { events: [], hasMore: false };
          }
        } else if (viewClearedRef.current) {
          return { events: [], hasMore: false };
        }
      }
      
      if (isLoadMore) {
        // Append new events to existing ones
        setEvents(prevEvents => {
          const combined = [...prevEvents, ...sortedEvents];
          // Remove duplicates and sort
          const uniqueEvents = combined.filter((event, index, self) => 
            index === self.findIndex(e => e.id === event.id)
          );
          return uniqueEvents.sort((a: LowLevelEvent, b: LowLevelEvent) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
          });
        });
      } else if (!isPollingUpdate) {
        // Initial load or filter change
        setEvents(sortedEvents);
        setCurrentOffset(sortedEvents.length);
        previousEventsRef.current = sortedEvents;
      }
      
      return { 
        events: sortedEvents, 
        hasMore: data.hasMore !== false && sortedEvents.length === limit,
        totalEventCount: data.totalEventCount
      };
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      return { events: [], hasMore: false };
    } finally {
      if (!isPollingUpdate && !isLoadMore) {
        setLoading(false);
      } else if (isLoadMore) {
        setLoadingMore(false);
      }
    }
  }, [userId, sortOrder, selectedEventType]);

  // Initial fetch and auto-loading logic
  useEffect(() => {
    const initializeData = async () => {
      if (!userId) return;
      
      // Reset state for new load
      setEvents([]);
      setCurrentOffset(0);
      setHasMoreData(true);
      setAutoLoadingComplete(false);
      viewClearedRef.current = false;
      
      // Initial load
      const result = await fetchRawEvents(INITIAL_CHUNK_SIZE, 0, false, false);
      if (result.events.length > 0) {
        setCurrentOffset(result.events.length);
        setHasMoreData(result.hasMore);
        
        // Start auto-loading additional chunks
        let currentLoadedCount = result.events.length;
        let currentOffsetValue = result.events.length;
        let hasMore = result.hasMore;
        
        while (hasMore && currentLoadedCount < AUTO_LOAD_LIMIT) {
          const nextChunkSize = Math.min(AUTO_LOAD_CHUNK_SIZE, AUTO_LOAD_LIMIT - currentLoadedCount);
          const nextResult = await fetchRawEvents(nextChunkSize, currentOffsetValue, false, true);
          
          if (nextResult.events.length === 0) {
            hasMore = false;
            break;
          }
          
          currentLoadedCount += nextResult.events.length;
          currentOffsetValue += nextResult.events.length;
          hasMore = nextResult.hasMore;
          
          setCurrentOffset(currentOffsetValue);
          setHasMoreData(hasMore);
          
          // Small delay to prevent overwhelming the UI
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        setAutoLoadingComplete(true);
        setHasMoreData(hasMore);
      }
    };
    
         initializeData();
   }, [userId, selectedEventType, sortOrder, fetchRawEvents]);

  // Live polling every 2 seconds
  useEffect(() => {
    if (loading || !autoLoadingComplete) return; // Don't start polling until initial load is complete
    
    const interval = setInterval(() => {
      fetchRawEvents(INITIAL_CHUNK_SIZE, 0, true, false); // Poll for new events
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchRawEvents, loading, autoLoadingComplete]);

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

  const handleCopyPayload = (event: LowLevelEvent) => {
    navigator.clipboard.writeText(JSON.stringify(event.payload, null, 2)).then(() => {
      setCopiedEventId(event.id);
      setTimeout(() => setCopiedEventId(null), 2000);
    });
  };

  const handleCopyAllEvents = () => {
    const eventsJson = JSON.stringify(events, null, 2);
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
    if (!searchTerm) return events;
    const lowercasedFilter = searchTerm.toLowerCase();
    return events.filter(event => 
      JSON.stringify(event.payload).toLowerCase().includes(lowercasedFilter)
    );
  }, [events, searchTerm]);

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
    setEvents([]);
    setExpandedEvents({});
    setNewEventIds(new Set());
    setCurrentOffset(0);
    setHasMoreData(true);
    setAutoLoadingComplete(false);
    setMemoryUsage(0);
    setLoadAllProgress(null);
    viewClearedRef.current = true;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({}));
  };

  const loadMoreEvents = async () => {
    if (!hasMoreData || loadingMore) return;
    
    const currentMemoryMB = memoryUsage / (1024 * 1024);
    if (currentMemoryMB >= MAX_MEMORY_MB) {
      setError(`Memory limit reached (${MAX_MEMORY_MB}MB). Cannot load more events.`);
      return;
    }
    
    const result = await fetchRawEvents(MANUAL_LOAD_CHUNK_SIZE, currentOffset, false, true);
    if (result.events.length > 0) {
      setCurrentOffset(prev => prev + result.events.length);
      setHasMoreData(result.hasMore);
    } else {
      setHasMoreData(false);
    }
  };

  const loadAllEvents = async () => {
    if (!hasMoreData || loadingMore) return;
    
    // Calculate how many events remain
    const remainingEvents = totalAvailable ? totalAvailable - events.length : 0;
    
    // Warn user about large datasets
    if (remainingEvents > 10000) {
      const confirmed = window.confirm(
        `This will load ${remainingEvents.toLocaleString()} more events, which may take some time and use significant memory. Continue?`
      );
      if (!confirmed) return;
    }
    
    setLoadingMore(true);
    setError(null);
    setLoadAllProgress({ loaded: 0, total: remainingEvents });
    
    try {
      let currentOffsetValue = currentOffset;
      let hasMore: boolean = hasMoreData;
      let totalLoaded = 0;
      
      while (hasMore) {
        // Check memory limit before each chunk
        const currentMemoryMB = memoryUsage / (1024 * 1024);
        if (currentMemoryMB >= MAX_MEMORY_MB) {
          setError(`Memory limit reached (${MAX_MEMORY_MB}MB). Loaded ${totalLoaded.toLocaleString()} additional events.`);
          break;
        }
        
        // Load in chunks of 1000 for better performance
        const chunkSize = Math.min(1000, remainingEvents - totalLoaded);
        const result = await fetchRawEvents(chunkSize, currentOffsetValue, false, true);
        
        if (result.events.length === 0) {
          hasMore = false;
          break;
        }
        
        totalLoaded += result.events.length;
        currentOffsetValue += result.events.length;
        hasMore = result.hasMore;
        
        setCurrentOffset(currentOffsetValue);
        setHasMoreData(hasMore);
        setLoadAllProgress({ loaded: totalLoaded, total: remainingEvents });
        
        // Small delay to prevent UI blocking and allow progress updates
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      if (!hasMore) {
        setHasMoreData(false);
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load all events');
    } finally {
      setLoadingMore(false);
      setLoadAllProgress(null);
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

  // Update memory usage when events change
  useEffect(() => {
    const usage = estimateMemoryUsage(events);
    setMemoryUsage(usage);
  }, [events]);

  return (
    <div>
      <div className="flex items-center gap-2 py-2 border-b mb-2">
        <Clock />
        <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-black rounded-md">
          <span className="text-sm font-medium text-black">
            {events.length.toLocaleString()} events loaded
          </span>
          {totalAvailable && (
            <span className="text-xs text-gray-600">
              of {totalAvailable.toLocaleString()} total
            </span>
          )}
          {!autoLoadingComplete && (
            <span className="text-xs text-blue-600 animate-pulse">
              Auto-loading...
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 border border-gray-300 rounded-md">
          <span className="text-xs text-gray-600">
            Memory: {formatBytes(memoryUsage)}
          </span>
          {memoryUsage > 0 && (
            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ 
                  width: `${Math.min((memoryUsage / (MAX_MEMORY_MB * 1024 * 1024)) * 100, 100)}%` 
                }}
              />
            </div>
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
        <Button variant="black-outline" size="sm" onClick={handleCopyAllEvents} disabled={events.length === 0}>
          Copy All as JSON
        </Button>
        {autoLoadingComplete && hasMoreData && (
          <>
            <Button 
              variant="default" 
              size="sm" 
              onClick={loadMoreEvents} 
              disabled={loadingMore || memoryUsage >= MAX_MEMORY_MB * 1024 * 1024}
            >
              {loadingMore ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Load {MANUAL_LOAD_CHUNK_SIZE.toLocaleString()} More
                </>
              )}
            </Button>
                         <Button 
               variant="outline" 
               size="sm" 
               onClick={loadAllEvents} 
               disabled={loadingMore || memoryUsage >= MAX_MEMORY_MB * 1024 * 1024}
             >
               {loadingMore && loadAllProgress ? (
                 <>
                   <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                   Loading All... ({loadAllProgress.loaded.toLocaleString()}/{loadAllProgress.total.toLocaleString()})
                 </>
               ) : loadingMore ? (
                 <>
                   <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                   Loading All...
                 </>
               ) : (
                 <>
                   <Download className="h-4 w-4 mr-2" />
                   Load All
                   {totalAvailable && events.length < totalAvailable && (
                     <span className="ml-1 text-xs">
                       ({(totalAvailable - events.length).toLocaleString()} more)
                     </span>
                   )}
                 </>
               )}
             </Button>
          </>
        )}
      </div>
      
      {events.length > 0 && (
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
                          <Badge variant="outline">
                            Total Available: {totalAvailable.toLocaleString()}
                          </Badge>
                        )}
                        <Badge variant="outline">
                          Loaded: {events.length.toLocaleString()}
                        </Badge>
                        <Badge variant="outline">
                          Memory: {formatBytes(memoryUsage)}
                        </Badge>
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

      {loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center pt-16">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground mt-4">Loading Events...</p>
        </div>
      )}

      {error && <div className="text-red-500 font-bold p-2 bg-red-50 rounded-md">Error: {error}</div>}

      {!loading && !error && filteredEvents.length === 0 && (
        <p>
            {events.length > 0 ? "No events match your search." : "No low-level events found for this user."}
        </p>
      )}

      {loadAllProgress && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-800">
              Loading all events...
            </span>
            <span className="text-sm text-blue-600">
              {loadAllProgress.loaded.toLocaleString()} / {loadAllProgress.total.toLocaleString()}
            </span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div 
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ 
                width: `${Math.min((loadAllProgress.loaded / loadAllProgress.total) * 100, 100)}%` 
              }}
            />
          </div>
        </div>
      )}

      {autoLoadingComplete && !hasMoreData && events.length > 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-gray-600">
            All available events have been loaded ({events.length.toLocaleString()} total)
          </p>
        </div>
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
    </div>
  );
} 