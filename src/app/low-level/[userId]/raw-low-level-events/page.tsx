'use client';

import { useEffect, useState, use, useMemo, useCallback, useRef } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { JsonBlock } from '@/components/ui/code-block';
import { ChevronDown, ChevronUp, Clipboard, Check, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AnimatePresence, motion } from 'framer-motion';

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
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});
  const [copiedEventId, setCopiedEventId] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [newEventIds, setNewEventIds] = useState<Set<number>>(new Set());
  const { userId } = use(params);

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

  // Use ref to store previous events for comparison during polling
  const previousEventsRef = useRef<LowLevelEvent[]>([]);
  
  const fetchRawEvents = useCallback(async (isPollingUpdate = false) => {
    if (!userId) return;
    if (!isPollingUpdate) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await fetch(`/api/low-level/${userId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch raw events');
      }
      const data = await response.json();
      const sortedEvents = data.events.sort((a: LowLevelEvent, b: LowLevelEvent) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      });
      
      // If this is a polling update, detect new events
      if (isPollingUpdate && previousEventsRef.current.length > 0) {
        const existingEventIds = new Set(previousEventsRef.current.map((e: LowLevelEvent) => e.id));
        const newEvents = sortedEvents.filter((e: LowLevelEvent) => !existingEventIds.has(e.id));
        
        if (newEvents.length > 0) {
          const newIds = new Set<number>(newEvents.map((e: LowLevelEvent) => e.id));
          setNewEventIds(newIds);
        }
      }
      
      // Update the ref with current events for next comparison
      previousEventsRef.current = sortedEvents;
      
      setEvents(sortedEvents);
      setSessionCount(data.sessionCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      if (!isPollingUpdate) {
        setLoading(false);
      }
    }
  }, [userId, sortOrder]);

  // Initial fetch
  useEffect(() => {
    fetchRawEvents();
  }, [fetchRawEvents]);

  // Live polling every 2 seconds
  useEffect(() => {
    if (loading) return; // Don't start polling until initial load is complete
    
    const interval = setInterval(() => {
      fetchRawEvents(true); // Pass true to indicate this is a polling update
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchRawEvents, loading]);

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
            {events.length} events loaded
          </span>
          {events.length >= 300 && (
            <span className="text-xs text-gray-600">(capped at 300)</span>
          )}
        </div>

        <Input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64 border-black"
        />
        <Button variant="black-outline" size="sm" onClick={toggleSortOrder}>
          {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
        <Button variant="black-outline" size="sm" onClick={expandAll}>Expand All</Button>
        <Button variant="black-outline" size="sm" onClick={collapseAll}>Collapse All</Button>
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