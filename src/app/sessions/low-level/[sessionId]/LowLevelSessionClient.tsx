'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { LowLevelEvent } from '@/types';
import { useDebouncedCallback } from 'use-debounce';

export default function LowLevelSessionClient({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessionData = useCallback(async () => {
    const { data, error } = await supabase
      .from('low_level_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching low-level events:', error);
    } else {
      setEvents(data as LowLevelEvent[]);
    }
  }, [sessionId]);

  const debouncedFetch = useDebouncedCallback(fetchSessionData, 2000);

  useEffect(() => {
    const initialFetch = async () => {
      setLoading(true);
      await fetchSessionData();
      setLoading(false);
    };
    initialFetch();

    const channel = supabase
      .channel(`low-level-session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'low_level_events',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          console.log('New low-level event received!', payload);
          debouncedFetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, fetchSessionData, debouncedFetch]);

  if (loading) {
    return <div>Loading events...</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Low-Level Session: {sessionId}</h1>
      <div className="space-y-2">
        {events.map(event => (
          <pre key={event.id} className="p-2 border rounded bg-gray-100 text-xs">
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
} 