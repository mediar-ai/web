'use client';

import { useEffect, useState, use, useMemo, useCallback } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
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

type EventPayload = {
    payload?: {
        type?: string;
        event?: {
            screen?: {
                ui_tree?: string;
            };
            screenshot_diff?: {
                before_timestamp?: string;
                after_timestamp?: string;
            };
            [key: string]: unknown;
        };
    }
};

const ConciseEventView = ({ event }: { event: LowLevelEvent }) => {
  const payload = event.payload as EventPayload;
  const eventType = payload?.payload?.type ?? 'unknown';
  const eventData = payload?.payload?.event ?? {};

  let summary: React.ReactNode = <span>Type: {eventType}</span>;
  switch (eventType) {
    case 'keyboard':
      const keyboardEvent = eventData.keyboard as { key_code: number, keys?: string, is_key_down?: boolean };
      const key = keyboardEvent?.keys;
      const keyCode = keyboardEvent?.key_code;
      const keyState = keyboardEvent?.is_key_down ? '(down)' : '(up)';

      if (key) {
        const keyName = key.length > 1 ? key.replace(/([A-Z])/g, ' $1').trim() : key;
        summary = <span><b>Keyboard:</b> {keyName} {keyState}</span>;
      } else if (keyCode) {
        const char = String.fromCharCode(keyCode);
        summary = <span><b>Keyboard:</b> {char} {keyState}</span>;
      } else {
        summary = <span><b>Keyboard:</b> Unknown key</span>;
      }
      break;
    case 'mouse':
      const mouseEvent = eventData.mouse as { button?: string, metadata?: { ui_element?: { application?: string, id?: string, name?: string, role?: string } }, event_type?: string };
      const button = mouseEvent?.button || 'click';
      const eventTypeStr = mouseEvent?.event_type ? `(${mouseEvent.event_type.toLowerCase()})` : '';
      const appName = mouseEvent?.metadata?.ui_element?.application || eventData.app_name as string || 'Unknown App';
      const elementName = mouseEvent?.metadata?.ui_element?.name || '<NO NAME>';
      const elementRole = mouseEvent?.metadata?.ui_element?.role || '';
      
      const truncatedName = elementName.length > 20 ? `${elementName.substring(0, 20)}...` : elementName;

      if (elementName) {
        summary = <span title={elementName}><b>Mouse:</b> {button} {eventTypeStr} on {elementRole && <b>{elementRole.toUpperCase()}</b>} &quot;{truncatedName}&quot; in {appName}</span>;
      } else {
        summary = <span><b>Mouse:</b> {button} {eventTypeStr} in {appName}</span>;
      }
      break;
    case 'application_switch':
      summary = <span><b>App Switch:</b> {eventData.app_name as string}</span>;
      break;
    case 'browser_tab_navigation':
      summary = <span><b>Browser Nav:</b> {eventData.url as string}</span>;
      break;
    case 'text_input_completed':
      summary = <span><b>Text Input:</b> &quot;{eventData.text as string}&quot; in {eventData.app_name as string}</span>;
      break;
    case 'ui_tree':
      try {
        const uiTree = JSON.parse(eventData.screen?.ui_tree as string);
        summary = <span><b>UI Tree captured for</b> {uiTree.attributes?.name || eventData.app_name as string}</span>;
      } catch {
        summary = <span><b>UI Tree captured for</b> {eventData.app_name as string}</span>;
      }
      break;
    case 'screenshot_diff':
      const diffData = eventData.screenshot_diff;
      const before = diffData?.before_timestamp ? new Date(diffData.before_timestamp as string).toLocaleTimeString() : 'N/A';
      const after = diffData?.after_timestamp ? new Date(diffData.after_timestamp as string).toLocaleTimeString() : 'N/A';
      summary = <span><b>Screenshot Diff:</b> {before} vs {after}</span>;
      break;
  }

  return (
    <div className="text-sm font-medium truncate pr-4" title={typeof summary === 'string' ? summary : undefined}>
      {summary}
    </div>
  );
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
  const { userId } = use(params);

  const LOCAL_STORAGE_KEY = `low-level-viewer-expanded-events-${userId}`;
  const SUMMARY_OPEN_STORAGE_KEY = `raw-events-summary-open-${userId}`;
  const SORT_ORDER_STORAGE_KEY = `raw-events-sort-order-${userId}`;

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

  const fetchRawEvents = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
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
      setEvents(sortedEvents);
      setSessionCount(data.sessionCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId, sortOrder]);

  useEffect(() => {
    fetchRawEvents();
  }, [fetchRawEvents]);

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
        <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-md">
          <span className="text-sm font-medium text-blue-800">
            {events.length} events loaded
          </span>
          {events.length >= 1000 && (
            <span className="text-xs text-blue-600">(capped at 1000)</span>
          )}
        </div>
        <Input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-64"
        />
        <Button variant="outline" size="sm" onClick={toggleSortOrder}>
          {sortOrder === 'desc' ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
        </Button>
        <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
        <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
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
                </div>
                {seenWindows.length > 0 && (
                    <div>
                        <h4 className="text-xs font-semibold mb-1 mt-2">Windows Used:</h4>
                        <div className="flex flex-col space-y-1 mt-1 items-start">
                            {seenWindows.map((windowName) => (
                                <Badge
                                    key={windowName}
                                    variant={selectedWindow === windowName ? 'default' : 'outline'}
                                    onClick={() => handleWindowClick(windowName)}
                                    className="cursor-pointer text-xs"
                                >
                                    {windowName}
                                </Badge>
                            ))}
                        </div>
                    </div>
                )}
                {clientIdentity && (
                    <div>
                        <h4 className="text-xs font-semibold mb-1 mt-2">Client Info:</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs p-2 border rounded-md">
                            {Object.entries(clientIdentity).map(([key, value]) => {
                                if (key === 'ip_location' && typeof value === 'object' && value !== null) {
                                    return (
                                        <div key={key} className="col-span-full">
                                            <h5 className="font-semibold">{key}:</h5>
                                            <div className="pl-2 grid grid-cols-2 md:grid-cols-3 gap-x-4">
                                                {Object.entries(value).map(([ipKey, ipValue]) => (
                                                    <div key={ipKey}>
                                                        <span className="font-semibold">{ipKey}:</span> {String(ipValue)}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                }
                                return (
                                    <div key={key}>
                                        <span className="font-semibold">{key}:</span> {String(value)}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </CardContent>
            </motion.div>
                )}
            </AnimatePresence>
        </Card>
      )}

      {loading && (
        <div className="space-y-4 p-1">
          <div className="flex items-center gap-2 py-2 border-b mb-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-10 w-64" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="border rounded-md p-4 mb-2">
            <Skeleton className="h-6 w-1/4 mb-4" />
            <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
            </div>
          </div>
          <div className="flex flex-col items-center justify-center pt-16">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-muted-foreground mt-4">Loading Events...</p>
          </div>
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
          return (
          <Card key={event.id}>
            <CardHeader 
              className="p-2 bg-gray-50 border-b flex flex-row justify-between items-center cursor-pointer"
              onClick={() => toggleEventExpansion(event.id)}
            >
              <ConciseEventView event={event} />
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-gray-500">{new Date(event.created_at).toISOString()}</span>
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
                    <pre className="p-2 text-xs overflow-auto">
                      {JSON.stringify(event.payload, null, 2)}
                    </pre>
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