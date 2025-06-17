'use client';

import { useEffect, useState, use, useMemo, useCallback } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AnimatePresence, motion } from 'framer-motion';

// New Clock component
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
            [key: string]: unknown;
        };
    }
};

const ConciseEventView = ({ event }: { event: LowLevelEvent }) => {
  const payload = event.payload as EventPayload;
  const eventType = payload?.payload?.type ?? 'unknown';
  const eventData = payload?.payload?.event ?? {};

  let summary = `Type: ${eventType}`;
  switch (eventType) {
    case 'keyboard':
      summary = `Keyboard: ${eventData.keys as string}`;
      break;
    case 'mouse':
      summary = `Mouse: ${eventData.button as string} click at (${eventData.x as number}, ${eventData.y as number})`;
      break;
    case 'application_switch':
      summary = `App Switch: ${eventData.app_name as string}`;
      break;
    case 'browser_tab_navigation':
      summary = `Browser Nav: ${eventData.url as string}`;
      break;
    case 'text_input_completed':
      summary = `Text Input: "${eventData.text as string}" in ${eventData.app_name as string}`;
      break;
    case 'ui_tree':
      summary = `UI Tree captured for ${eventData.app_name as string}`;
      break;
    case 'screenshot_diff':
      summary = `Screenshot Diff`;
      break;
  }

  return (
    <div className="text-sm font-medium truncate pr-4" title={summary}>
      {summary}
    </div>
  );
};

export default function LowLevelViewerPage({ params }: { params: Promise<{ userId: string }> }) {
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEventType, setSelectedEventType] = useState<string | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<string | null>(null);
  const [isSummaryOpen, setIsSummaryOpen] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Record<number, boolean>>({});
  const { userId } = use(params);
  const [userName, setUserName] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const LOCAL_STORAGE_KEY = 'low-level-viewer-expanded-events';

  // Load initial state from localStorage
  useEffect(() => {
    try {
      const storedState = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedState) {
        setExpandedEvents(JSON.parse(storedState));
      } else {
        // Default to collapsed if nothing is stored
        setExpandedEvents({});
      }
    } catch (error) {
        console.error("Failed to parse expanded events from localStorage", error);
        setExpandedEvents({}); // Default to collapsed on error
    }
  }, []);

  const fetchUserName = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await fetch(`/api/users/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setUserName(data.name || null);
        setNameInput(data.name || '');
      }
    } catch (err) {
      console.error("Failed to fetch user name", err);
    }
  }, [userId]);

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
      setEvents(data.events);
      setSessionCount(data.sessionCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchRawEvents();
    fetchUserName();
  }, [fetchRawEvents, fetchUserName]);

  const toggleSummary = () => setIsSummaryOpen(prev => !prev);

  const toggleEventExpansion = (eventId: number) => {
    setExpandedEvents(prev => {
      const newState = {
        ...prev,
        [eventId]: !prev[eventId]
      };
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

  const handleSaveName = async () => {
    if (!userId) return;
    try {
      await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput }),
      });
      setUserName(nameInput);
      setIsEditingName(false);
    } catch (err) {
      console.error("Failed to save user name", err);
      // Optionally show an error to the user
    }
  };

  const searchedEvents = useMemo(() => {
    if (!searchTerm) {
      return events;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return events.filter(event => 
      JSON.stringify(event.payload).toLowerCase().includes(lowercasedFilter)
    );
  }, [events, searchTerm]);

  const eventTypeFilteredEvents = useMemo(() => {
    if (!selectedEventType) {
      return searchedEvents;
    }
    return searchedEvents.filter(event => {
      const body = event.payload as Record<string, unknown>;
      const eventType = (body.payload as Record<string, unknown>)?.type as string || 'unknown';
      return eventType === selectedEventType;
    });
  }, [searchedEvents, selectedEventType]);

  const filteredEvents = useMemo(() => {
    if (!selectedWindow) {
      return eventTypeFilteredEvents;
    }
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
      } catch {
        // Ignore parsing errors
      }
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
      } catch {
        // Ignore parsing errors for now
      }
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
    <div className="container mx-auto font-mono">
      <div className="sticky top-0 z-10 bg-white dark:bg-black py-2 border-b mb-2">
        <div className="container mx-auto flex flex-col gap-2">
            <div className="flex items-center">
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="text-2xl font-bold h-10"
                    placeholder="Enter user name"
                  />
                  <Button onClick={handleSaveName} size="sm">Save</Button>
                  <Button variant="outline" onClick={() => setIsEditingName(false)} size="sm">Cancel</Button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-2 cursor-pointer group"
                  onClick={() => {
                    setNameInput(userName || '');
                    setIsEditingName(true);
                  }}
                >
                  <h1 className="text-2xl font-bold">
                    <span className="border-b border-dotted border-transparent group-hover:border-gray-400">{userName || 'Unnamed User'}</span>
                    <span className="text-gray-500 font-normal ml-2">({userId})</span>
                  </h1>
                  <Pencil className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
                <Clock />
                <Input
                    type="text"
                    placeholder="Search events..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-64"
                />
                 <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
                 <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
                <Button variant="outline" onClick={fetchRawEvents}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </Button>
                <div className="ml-auto">
                    <Link href="/admin">
                        <Button variant="outline">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Admin
                        </Button>
                    </Link>
                </div>
            </div>
        </div>
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
                                if (key === 'ip_location' && typeof value === 'string') {
                                    try {
                                        const ipInfo = JSON.parse(value);
                                        return (
                                            <div key={key} className="col-span-full">
                                                <h5 className="font-semibold">{key}:</h5>
                                                <div className="pl-2 grid grid-cols-2 md:grid-cols-3 gap-x-4">
                                                    {Object.entries(ipInfo).map(([ipKey, ipValue]) => (
                                                        <div key={ipKey}>
                                                            <span className="font-semibold">{ipKey}:</span> {String(ipValue)}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    } catch {
                                        return (
                                            <div key={key}>
                                                <span className="font-semibold">{key}:</span> {value}
                                            </div>
                                        );
                                    }
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
        <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
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
                  <CardContent className="p-0">
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