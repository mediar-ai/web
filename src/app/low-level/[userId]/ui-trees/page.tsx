'use client';

import { useEffect, useState, use, useCallback, useMemo } from 'react';
import { type LowLevelEvent } from '@/types';
import { getSharedEventsStorage } from '@/lib/sharedEventsStorage';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, Clipboard, Check, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { JsonBlock } from '@/components/ui/code-block';
import DiffView from '@/components/low-level/DiffView';
import { preprocessTree } from '@/lib/diff';
import { diffLines } from 'diff';
import { toast } from 'sonner';

type UITreePayload = {
  type?: string;
  timestamp?: string;
  event?: {
    screen?: { ui_tree?: string };
    app_name?: string;
  };
  payload?: {
    type?: string;
    timestamp?: string;
    event?: {
      screen?: { ui_tree?: string };
      app_name?: string;
    };
  };
};

type UITreeEvent = LowLevelEvent & {
  payload: UITreePayload;
};

type GroupedUITrees = {
  [windowName: string]: UITreeEvent[];
};

// Helpers to safely access data from different event structures
const getUITree = (event: LowLevelEvent): string | undefined => {
  const payload = event.payload as UITreePayload;
  return payload?.event?.screen?.ui_tree || payload?.payload?.event?.screen?.ui_tree;
};

const getAppName = (event: LowLevelEvent): string | undefined => {
  const payload = event.payload as UITreePayload;
  return payload?.event?.app_name || payload?.payload?.event?.app_name;
};

const getEventTimestamp = (event: LowLevelEvent): string => {
  const payload = event.payload as UITreePayload;
  return payload?.timestamp || payload?.payload?.timestamp || event.created_at;
};

export default function UITreesPage({ params }: { params: Promise<{ userId: string }> }) {
  const [events, setEvents] = useState<UITreeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usingCachedData, setUsingCachedData] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedEvent, setSelectedEvent] = useState<UITreeEvent | null>(null);
  const [diffMode, setDiffMode] = useState<'raw' | 'previous' | 'next'>('raw');
  const [isCopied, setIsCopied] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const { userId } = use(params);
  const sharedStorage = getSharedEventsStorage(userId);
  const [currentLimit, setCurrentLimit] = useState(50);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [liveUpdateIndicator, setLiveUpdateIndicator] = useState(false);
  const [isAutoLoading, setIsAutoLoading] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ eventCount: number; sizeMB: string } | null>(null);

  const SORT_ORDER_STORAGE_KEY = `ui-trees-sort-order-${userId}`;

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

  const fetchUITrees = useCallback(async (limit: number = 50, loadMore: boolean = false) => {
    if (!userId) return;
    if (!loadMore) {
      setLoading(true);
      setError(null);
    } else {
      setIsLoadingMore(true);
    }
    try {
      // First, try to load UI tree events from IndexedDB cache
      const cachedData = await sharedStorage.getCachedEvents(limit, 0, true); // Get UI tree events only
      
      if (cachedData.events.length > 0) {
        console.log(`[UI Trees] Loaded ${cachedData.events.length} UI tree events from IndexedDB cache`);
        if (!loadMore) {
          setEvents(cachedData.events as UITreeEvent[]);
          setUsingCachedData(true);
          setLoading(false);
        } else {
          setEvents(prev => [...prev, ...cachedData.events.slice(events.length)] as UITreeEvent[]);
          setIsLoadingMore(false);
        }
        setHasMore(cachedData.hasMore);
        
        // Update storage info
        const uiTreeCount = cachedData.events.length;
        setStorageInfo({
          eventCount: uiTreeCount,
          sizeMB: (uiTreeCount * 0.01).toFixed(1) // Rough estimate
        });
        
        // Continue to check for new UI tree events in background
        if (!loadMore) {
          console.log('[UI Trees] Checking for new UI tree events in background...');
        }
      }
      
      // Always check API for fresh data (either as fallback or background refresh)
      if (cachedData.events.length === 0) {
        console.log('[UI Trees] No cached data found, fetching from API');
        setUsingCachedData(false);
      }
      const response = await fetch(`/api/low-level/${userId}/ui-trees?limit=${limit}`);
      if (!response.ok) {
        throw new Error('Failed to fetch UI tree events');
      }
      const data = await response.json();
      setHasMore(data.hasMore || false);
      
      // If we had cached data, check for new UI tree events and merge
      if (cachedData.events.length > 0) {
        const cachedIds = new Set(cachedData.events.map(e => e.id));
        const reallyNewEvents = data.events.filter((e: UITreeEvent) => !cachedIds.has(e.id));
        
        if (reallyNewEvents.length > 0) {
          console.log(`[UI Trees] Found ${reallyNewEvents.length} new UI tree events, updating cache and UI`);
          if (!loadMore) {
            const mergedEvents = [...reallyNewEvents, ...cachedData.events] as UITreeEvent[];
            setEvents(mergedEvents);
          } else {
            setEvents(prev => [...prev, ...reallyNewEvents] as UITreeEvent[]);
          }
          
          // Save new events to cache
          await sharedStorage.saveEvents(reallyNewEvents);
        } else {
          console.log('[UI Trees] No new UI tree events found');
        }
      } else {
        // No cached data, use fresh data as-is
        if (!loadMore) {
          setEvents(data.events);
        } else {
          setEvents(prev => [...prev, ...data.events] as UITreeEvent[]);
        }
        
        // Save to cache for future use
        if (data.events && data.events.length > 0) {
          await sharedStorage.saveEvents(data.events);
          console.log(`[UI Trees] Saved ${data.events.length} UI tree events to IndexedDB for future use`);
        }
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId, sharedStorage, events.length]);

  const loadMoreUITrees = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    const newLimit = currentLimit + 50;
    setCurrentLimit(newLimit);
    await fetchUITrees(newLimit, true);
  }, [isLoadingMore, hasMore, currentLimit, fetchUITrees]);

  const autoLoadMore = useCallback(async () => {
    if (isAutoLoading || !hasMore) return;
    
    // Memory protection - warn if approaching large dataset
    if (events.length > 5000) {
      const shouldContinue = window.confirm(
        `Memory Protection\n\nYou're about to auto-load more than 5,000 UI trees. This may slow down your browser.\n\nCurrent: ${events.length} trees\nEstimated memory: ${(events.length * 0.01).toFixed(1)}MB\n\nContinue auto-loading?`
      );
      if (!shouldContinue) return;
    }
    
    setIsAutoLoading(true);
    
    try {
      let currentCount = events.length;
      const batchSize = 100;
      
      while (hasMore && currentCount < 10000) { // Safety limit
        const newLimit = currentCount + batchSize;
        setCurrentLimit(newLimit);
        await fetchUITrees(newLimit, true);
        currentCount += batchSize;
        
        // Small delay to prevent browser freezing
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (currentCount >= 10000) {
        toast.warning('Auto-loading stopped at 10,000 UI trees for performance reasons.');
      }

    } catch (error) {
      console.error('[UI Trees] Auto-loading failed:', error);
    } finally {
      setIsAutoLoading(false);
    }
  }, [isAutoLoading, hasMore, events.length, fetchUITrees]);

  const loadAllUITrees = useCallback(async () => {
    if (!hasMore) return;
    
    // Memory protection - require confirmation for large datasets
    const shouldContinue = window.confirm(
      `Load All UI Trees\n\nThis will load ALL remaining UI trees at once. This may:\n• Use significant memory (${(events.length * 0.02).toFixed(1)}+ MB)\n• Slow down your browser\n• Take several minutes\n\nCurrent: ${events.length} trees\n\nProceed with loading all?`
    );
    
    if (!shouldContinue) return;
    
    setIsLoadingMore(true);
    
    try {
      // Load in large batches but with safety limits
      const response = await fetch(`/api/low-level/${userId}/ui-trees?limit=50000`);
      if (!response.ok) throw new Error('Failed to fetch all UI trees');
      
      const data = await response.json();
      setEvents(data.events);
      setHasMore(false);
      setCurrentLimit(data.events.length);
      
      // Update cache with all data
      if (data.events && data.events.length > 0) {
        await sharedStorage.saveEvents(data.events);
        console.log(`[UI Trees] Loaded and cached ${data.events.length} UI trees`);
      }

    } catch (error) {
      console.error('[UI Trees] Load all failed:', error);
      toast.error('Failed to load all UI trees. Please try again.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, events.length, userId, sharedStorage]);

  const forceRefreshFromAPI = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    setUsingCachedData(false);
    
    try {
      console.log('[UI Trees] Force refreshing from API');
      const response = await fetch(`/api/low-level/${userId}/ui-trees`);
      if (!response.ok) {
        throw new Error('Failed to fetch UI tree events');
      }
      const data = await response.json();
      setEvents(data.events);
      
      // Update cache with fresh data
      if (data.events && data.events.length > 0) {
        await sharedStorage.saveEvents(data.events);
        console.log(`[UI Trees] Updated cache with ${data.events.length} fresh UI tree events`);
      }
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId, sharedStorage]);

  useEffect(() => {
    fetchUITrees();
  }, [fetchUITrees]);

  // Live polling for new UI trees every 4 seconds
  useEffect(() => {
    if (!userId || loading) return; // Don't start polling until initial load is complete

    const pollForNewUITrees = async () => {
      try {
        // Check for new UI tree events by fetching latest 5 and comparing
        const response = await fetch(`/api/low-level/${userId}/ui-trees?limit=5`);
        if (!response.ok) return;
        
        const data = await response.json();
        const latestUITrees = data.events || [];
        
        if (latestUITrees.length > 0 && events.length > 0) {
          // Check if we have any new UI trees by comparing IDs
          const existingIds = new Set(events.slice(0, 5).map(e => e.id));
          const newUITrees = latestUITrees.filter((e: UITreeEvent) => !existingIds.has(e.id));
          
          if (newUITrees.length > 0) {
            console.log(`[UI Trees] Found ${newUITrees.length} new UI trees via polling`);
            setLiveUpdateIndicator(true);
            setEvents(prevEvents => [...newUITrees, ...prevEvents] as UITreeEvent[]);
            
            // Save new UI trees to cache
            await sharedStorage.saveEvents(newUITrees);
            
            // Hide indicator after 2 seconds
            setTimeout(() => setLiveUpdateIndicator(false), 2000);
          }
        }
      } catch (error) {
        console.error('[UI Trees] Error polling for new UI trees:', error);
      }
    };

    // Poll immediately and then every 4 seconds
    const interval = setInterval(pollForNewUITrees, 4000);

    return () => clearInterval(interval);
  }, [userId, loading, events, sharedStorage]);

  const toggleSortOrder = () => {
    setSortOrder(prev => {
      const newOrder = prev === 'asc' ? 'desc' : 'asc';
      localStorage.setItem(SORT_ORDER_STORAGE_KEY, newOrder);
      return newOrder;
    });
  };

  const toggleGroupExpansion = (groupName: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupName]: !prev[groupName]
    }));
    // Reset selected event when collapsing/expanding a group
    setSelectedEvent(null);
  };

  const handleEventSelection = (event: UITreeEvent, eventGroup: UITreeEvent[]) => {
    const selectedIndex = eventGroup.findIndex(e => e.id === event.id);
    const hasPrevious = selectedIndex > 0;
    
    setSelectedEvent(event);
    setDiffMode(hasPrevious ? 'previous' : 'raw');
  };

  const getEventTitle = (event: UITreeEvent) => {
    const appName = getAppName(event) || 'Unknown App';
    const uiTree = getUITree(event);
    if (uiTree) {
      try {
        const parsedTree = JSON.parse(uiTree);
        return parsedTree.attributes?.name || appName;
      } catch {
        return appName;
      }
    }
    return appName;
  }

  const getDiffText = (oldTree: string, newTree: string) => {
    const differences = diffLines(preprocessTree(oldTree), preprocessTree(newTree));
    return differences
      .filter(part => part.added || part.removed)
      .map(part => {
        const prefix = part.added ? '+ ' : part.removed ? '- ' : '';
        return prefix + part.value;
      })
      .join('');
  }

  const handleCopy = (currentTree: string, previousTree?: string, nextTree?: string) => {
    let textToCopy = '';
    if (diffMode === 'raw') {
      textToCopy = JSON.stringify(JSON.parse(currentTree), null, 2);
    } else if (diffMode === 'previous' && previousTree) {
      textToCopy = getDiffText(previousTree, currentTree);
    } else if (diffMode === 'next' && nextTree) {
      textToCopy = getDiffText(currentTree, nextTree);
    }
    
    navigator.clipboard.writeText(textToCopy).then(() => {
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    });
  };

  const groupedEvents = useMemo<GroupedUITrees>(() => {
    const groups: GroupedUITrees = {};
    events.forEach(event => {
      const title = getEventTitle(event);
      if (!groups[title]) {
        groups[title] = [];
      }
      groups[title].push(event);
    });
    // Sort events within each group by timestamp ascending (oldest first)
    for (const title in groups) {
        groups[title].sort((a, b) => new Date(getEventTimestamp(a)).getTime() - new Date(getEventTimestamp(b)).getTime());
    }
    return groups;
  }, [events]);

  const sortedGroupedEvents = useMemo(() => {
    return Object.entries(groupedEvents).sort(([, groupA], [, groupB]) => {
      const firstEventA = groupA[0];
      const firstEventB = groupB[0];
      if (!firstEventA || !firstEventB) return 0;

      const timeA = new Date(getEventTimestamp(firstEventA)).getTime();
      const timeB = new Date(getEventTimestamp(firstEventB)).getTime();

      return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });
  }, [groupedEvents, sortOrder]);

  const formatPeriod = (start: string, end: string) => {
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
      timeZoneName: 'short',
    };

    const startDate = new Date(start);
    const endDate = new Date(end);
    const startLocaleDate = startDate.toLocaleDateString('en-US', options);
    const endLocaleDate = endDate.toLocaleDateString('en-US', options);
    const startLocaleTime = startDate.toLocaleTimeString('en-US', timeOptions);
    const endLocaleTime = endDate.toLocaleTimeString('en-US', timeOptions);

    if (startLocaleDate === endLocaleDate) {
        return `${startLocaleDate}, ${startLocaleTime} - ${endLocaleTime}`;
    } else {
        return `${startLocaleDate}, ${startLocaleTime} - ${endLocaleDate}, ${endLocaleTime}`;
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between py-2 border-b mb-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={toggleSortOrder}>
            {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4 mr-2" /> : <ArrowUp className="h-4 w-4 mr-2" />}
            Sort Events
          </Button>
          {usingCachedData && (
            <Button variant="outline" size="sm" onClick={forceRefreshFromAPI} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          )}
          {hasMore && (
            <>
              <Button variant="outline" size="sm" onClick={loadMoreUITrees} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading...' : 'Load More'}
              </Button>
              <Button variant="outline" size="sm" onClick={autoLoadMore} disabled={isAutoLoading || isLoadingMore}>
                {isAutoLoading ? 'Auto Loading...' : 'Auto Load'}
              </Button>
              <Button variant="outline" size="sm" onClick={loadAllUITrees} disabled={isLoadingMore}>
                Load All
              </Button>
            </>
          )}
        </div>
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <span>Total Trees: {events.length}</span>
          {storageInfo && (
            <Badge variant="outline" className="text-xs">
              {storageInfo.sizeMB}MB
            </Badge>
          )}
          {usingCachedData && (
            <Badge variant="outline" className="text-xs">
              IndexedDB
            </Badge>
          )}
          {liveUpdateIndicator && (
            <Badge variant="outline" className="text-xs animate-pulse">
              Live Update
            </Badge>
          )}
          {isAutoLoading && (
            <Badge variant="outline" className="text-xs animate-pulse">
              Auto Loading
            </Badge>
          )}
        </div>
      </div>
      
      {/* Load More indicator */}
      {isLoadingMore && (
        <div className="flex items-center space-x-2 my-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Loading more UI trees...</span>
        </div>
      )}
      
      {/* Auto Loading indicator */}
      {isAutoLoading && (
        <div className="flex items-center space-x-2 my-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>Auto-loading UI trees... ({events.length} loaded)</span>
        </div>
      )}
      
      {loading && (
        <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <div className="border rounded-md">
                <Skeleton className="h-14 w-full" />
                <div className="p-8 flex flex-col items-center justify-center">
                    <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-muted-foreground mt-4">Loading UI Trees...</p>
                </div>
            </div>
            <Skeleton className="h-14 w-full" />
        </div>
      )}

      {error && <div className="text-red-500 font-bold p-2 bg-red-50 rounded-md">Error: {error}</div>}

      {!loading && !error && Object.keys(groupedEvents).length === 0 && (
        <p>No UI tree events found for this user.</p>
      )}

      <div className="space-y-2">
        {sortedGroupedEvents.map(([windowName, eventGroup]) => {
          const isExpanded = expandedGroups[windowName] || false;
          const firstEvent = eventGroup[0];
          const lastEvent = eventGroup[eventGroup.length - 1];

          const selectedEventIndex = selectedEvent ? eventGroup.findIndex(e => e.id === selectedEvent.id) : -1;
          const previousEvent = selectedEventIndex > 0 ? eventGroup[selectedEventIndex - 1] : null;
          const nextEvent = selectedEventIndex !== -1 && selectedEventIndex < eventGroup.length - 1 ? eventGroup[selectedEventIndex + 1] : null;

          const currentTree = selectedEvent ? getUITree(selectedEvent) : undefined;
          const previousTree = previousEvent ? getUITree(previousEvent) : undefined;
          const nextTree = nextEvent ? getUITree(nextEvent) : undefined;

          return (
            <Card key={windowName}>
              <CardHeader
                className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer"
                onClick={() => toggleGroupExpansion(windowName)}
              >
                <CardTitle className="text-sm font-medium truncate pr-4" title={windowName}>
                  {windowName.length > 50 ? `${windowName.substring(0, 50)}...` : windowName} ({eventGroup.length})
                </CardTitle>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">
                    {formatPeriod(getEventTimestamp(firstEvent), getEventTimestamp(lastEvent))}
                  </span>
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
                    <CardContent className="p-2">
                        <div className="flex flex-wrap gap-1 mb-2">
                            {eventGroup.map(event => (
                                <Button 
                                    key={event.id}
                                    variant={selectedEvent?.id === event.id ? "default" : "outline"}
                                    size="sm"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleEventSelection(event, eventGroup);
                                    }}
                                >
                                  <div className="flex-none text-sm text-gray-500">
                                    {new Date(getEventTimestamp(event)).toLocaleTimeString('en-US', {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                      timeZone: 'UTC',
                                      timeZoneName: 'short',
                                    })}
                                  </div>
                                </Button>
                            ))}
                        </div>
                        {selectedEvent && currentTree && (
                           <div className="space-y-2">
                             <div className="flex justify-between items-center">
                                <ToggleGroup type="single" value={diffMode} onValueChange={(value: 'raw' | 'previous' | 'next') => value && setDiffMode(value)} className="justify-start">
                                    <div className="mr-1"><ToggleGroupItem value="previous" disabled={!previousEvent}>Diff Previous</ToggleGroupItem></div>
                                    <div className="mr-1"><ToggleGroupItem value="raw">Raw</ToggleGroupItem></div>
                                    <div className="mr-1"><ToggleGroupItem value="next" disabled={!nextEvent}>Diff Next</ToggleGroupItem></div>
                                </ToggleGroup>
                                <Button variant="ghost" size="icon" onClick={() => handleCopy(currentTree, previousTree, nextTree)} className="h-8 w-8">
                                  {isCopied ? <Check className="h-4 w-4 text-green-500" /> : <Clipboard className="h-4 w-4" />}
                                </Button>
                             </div>

                            {diffMode === 'raw' && (
                                <JsonBlock
                                    data={JSON.parse(currentTree)}
                                    theme="light"
                                    size="sm"
                                    maxHeight="400px"
                                />
                            )}
                            {diffMode === 'previous' && previousTree && (
                                <DiffView oldTree={previousTree} newTree={currentTree} />
                            )}
                            {diffMode === 'next' && nextTree && (
                                <DiffView oldTree={currentTree} newTree={nextTree} />
                            )}
                           </div>
                        )}
                    </CardContent>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          )
        })}
      </div>
    </div>
  );
} 