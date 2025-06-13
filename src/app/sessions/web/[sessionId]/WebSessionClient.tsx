'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ActivityItem } from '@/types';
import { useDebouncedCallback } from 'use-debounce';

export default function WebSessionClient({ sessionId }: { sessionId: string }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessionData = useCallback(async () => {
    // We don't need to set loading to true here for subsequent fetches,
    // as it would make the UI flicker. The initial load is handled below.
    const { data, error } = await supabase
      .from('user_activity_data')
      .select('*')
      .eq('session_id', sessionId)
      .order('client_timestamp', { ascending: false });

    if (error) {
      console.error('Error fetching web recorder data:', error);
    } else {
      setActivity(data?.map(d => d.item_data as ActivityItem) || []);
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
      .channel(`web-session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_activity_data',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          console.log('New web activity received!', payload);
          debouncedFetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, fetchSessionData, debouncedFetch]);

  if (loading) {
    return <div>Loading session data...</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Web Recorder Session: {sessionId}</h1>
      <div className="space-y-2">
        {activity.map(item => (
          <pre key={item.id} className="p-2 border rounded bg-gray-100 text-xs">
            {JSON.stringify(item, null, 2)}
          </pre>
        ))}
      </div>
    </div>
  );
} 