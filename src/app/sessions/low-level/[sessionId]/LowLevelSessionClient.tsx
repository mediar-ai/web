'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LowLevelEvent } from '@/types';

export default function LowLevelSessionClient({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSessionData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const { data, error } = await supabase
          .from('low_level_events')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching low-level session data:', error);
          setError(error.message);
        } else {
          setEvents(data || []);
        }
      } catch (err) {
        console.error('Error fetching low-level session data:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }

      setLoading(false);
    };
    
    fetchSessionData();
  }, [sessionId]);

  if (loading) {
    return <div>Loading session data...</div>;
  }

  if (error) {
    return <div>Error loading session data: {error}</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Low-Level Session: {sessionId}</h1>
      <p className="text-gray-600 mb-4">Found {events.length} events</p>
      <div className="space-y-2">
        {events.map(event => (
          <pre key={event.id} className="p-2 border rounded bg-gray-100 text-xs overflow-x-auto">
            {JSON.stringify(event, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
} 