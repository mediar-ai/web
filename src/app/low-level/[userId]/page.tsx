'use client';

import { useEffect, useState, use, useMemo, useCallback } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

// New Clock component
const Clock = () => {
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timerId = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timerId);
    }, []);

    return <div className="text-sm text-gray-500 font-mono">UTC: {time.toUTCString()}</div>;
};

export default function LowLevelViewerPage({ params }: { params: Promise<{ userId: string }> }) {
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { userId } = use(params);

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
  }, [fetchRawEvents]);

  const filteredEvents = useMemo(() => {
    if (!searchTerm) {
      return events;
    }
    const lowercasedFilter = searchTerm.toLowerCase();
    return events.filter(event => 
      JSON.stringify(event.payload).toLowerCase().includes(lowercasedFilter)
    );
  }, [events, searchTerm]);

  const eventStats = useMemo(() => {
    const stats = new Map<string, number>();
    for (const event of filteredEvents) {
      const body = event.payload as Record<string, unknown>;
      const eventType = (body.payload as Record<string, unknown>)?.type as string || 'unknown';
      stats.set(eventType, (stats.get(eventType) || 0) + 1);
    }
    return Array.from(stats.entries());
  }, [filteredEvents]);

  const seenWindows = useMemo(() => {
    const windows = new Set<string>();
    for (const event of filteredEvents) {
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
    return Array.from(windows);
  }, [filteredEvents]);

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
    <div className="container mx-auto py-4 font-mono">
      <div className="sticky top-0 z-10 bg-white dark:bg-black py-4 border-b mb-4">
        <div className="container mx-auto flex justify-between items-center">
            <div>
                <h1 className="text-2xl font-bold">Low-Level Event Inspector</h1>
                <p className="text-sm text-gray-500">User ID: {userId}</p>
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
                <Button variant="outline" onClick={fetchRawEvents}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </Button>
                <Link href="/admin">
                    <Button variant="outline">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Admin
                    </Button>
                </Link>
            </div>
        </div>
      </div>

      {events.length > 0 && (
        <Card className="mb-4">
            <CardHeader className="p-2 bg-gray-50 border-b">
                <CardTitle className="text-sm">Event Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-2 space-y-2">
                <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">Sessions: {sessionCount}</Badge>
                    {eventStats.map(([type, count]) => (
                        <Badge key={type} variant="secondary">{type}: {count}</Badge>
                    ))}
                </div>
                {seenWindows.length > 0 && (
                    <div>
                        <h4 className="text-xs font-semibold mb-1 mt-2">Windows Used:</h4>
                        <div className="flex flex-wrap gap-1">
                            {seenWindows.map((windowName) => (
                                <Badge key={windowName} variant="default">{windowName}</Badge>
                            ))}
                        </div>
                    </div>
                )}
                {clientIdentity && (
                    <div>
                        <h4 className="text-xs font-semibold mb-1 mt-2">Client Info:</h4>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-2 gap-y-1 text-xs">
                            {Object.entries(clientIdentity).map(([key, value]) => (
                                <div key={key}>
                                    <span className="font-semibold">{key}:</span> {JSON.stringify(value)}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
      )}

      {loading && (
        <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
        </div>
      )}

      {error && <div className="text-red-500 font-bold p-4 bg-red-50 rounded-md">Error: {error}</div>}

      {!loading && !error && filteredEvents.length === 0 && (
        <p>
            {events.length > 0 ? "No events match your search." : "No low-level events found for this user."}
        </p>
      )}

      <div className="space-y-2">
        {filteredEvents.map((event) => (
          <Card key={event.id}>
            <CardHeader className="p-2 bg-gray-50 border-b">
              <CardTitle className="text-sm flex justify-between items-center">
                <span>Event ID: {event.id}</span>
                <span className="text-xs text-gray-500">{new Date(event.created_at).toISOString()}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <pre className="p-2 text-xs overflow-auto">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
} 