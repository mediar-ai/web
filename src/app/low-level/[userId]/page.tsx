'use client';

import { useEffect, useState, use, useMemo } from 'react';
import { type LowLevelEvent } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

// Define a more specific type for the payload to avoid using 'any'
interface LowLevelEventPayload {
    type?: string;
    event?: {
        screen?: {
            ui_tree?: string;
        }
    }
}

export default function LowLevelViewerPage({ params }: { params: Promise<{ userId: string }> }) {
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { userId } = use(params);

  useEffect(() => {
    if (!userId) return;

    const fetchRawEvents = async () => {
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
    };

    fetchRawEvents();
  }, [userId]);

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
      const payload = event.payload as { payload?: LowLevelEventPayload };
      const eventType = payload.payload?.type || 'unknown';
      stats.set(eventType, (stats.get(eventType) || 0) + 1);
    }
    return Array.from(stats.entries());
  }, [filteredEvents]);

  const seenWindows = useMemo(() => {
    const windows = new Set<string>();
    for (const event of filteredEvents) {
      try {
        const payload = event.payload as { payload?: LowLevelEventPayload };
        const p = payload.payload;
        if (p?.event?.screen?.ui_tree) {
          const uiTree = JSON.parse(p.event.screen.ui_tree);
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

  return (
    <div className="container mx-auto py-8 font-mono">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h1 className="text-2xl font-bold">Low-Level Event Inspector</h1>
            <p className="text-sm text-gray-500">User ID: {userId}</p>
        </div>
        <div className="flex items-center gap-2">
            <Input 
                type="text"
                placeholder="Search events..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-64"
            />
            <Link href="/admin">
                <Button variant="outline">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Admin
                </Button>
            </Link>
        </div>
      </div>

      {events.length > 0 && (
        <Card className="mb-6">
            <CardHeader className="p-3 bg-gray-50 border-b">
                <CardTitle className="text-sm">Event Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Sessions: {sessionCount}</Badge>
                    {eventStats.map(([type, count]) => (
                        <Badge key={type} variant="secondary">{type}: {count}</Badge>
                    ))}
                </div>
                {seenWindows.length > 0 && (
                    <div>
                        <h4 className="text-xs font-semibold mb-2">Windows Used:</h4>
                        <div className="flex flex-wrap gap-2">
                            {seenWindows.map((windowName) => (
                                <Badge key={windowName} variant="default">{windowName}</Badge>
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

      <div className="space-y-4">
        {filteredEvents.map((event) => (
          <Card key={event.id}>
            <CardHeader className="p-3 bg-gray-50 border-b">
              <CardTitle className="text-sm flex justify-between items-center">
                <span>Event ID: {event.id}</span>
                <span className="text-xs text-gray-500">{new Date(event.created_at).toISOString()}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <pre className="p-3 text-xs overflow-auto">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
} 