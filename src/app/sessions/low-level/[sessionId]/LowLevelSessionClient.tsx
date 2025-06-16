'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { LowLevelEvent } from '@/types';

// Define a type for the processed activity data
interface ProcessedActivity {
  id: number;
  session_id: string;
  user_id: string;
  item_type: string;
  client_item_id: string;
  item_data: Record<string, unknown>;
  client_timestamp: string;
  source: string;
}

// Define a type for the combined, sorted logs
type CombinedLog = (LowLevelEvent | ProcessedActivity) & {
  log_type: 'raw' | 'processed';
  sort_timestamp: string;
};

export default function LowLevelSessionClient({ sessionId }: { sessionId: string }) {
  const [rawEvents, setRawEvents] = useState<LowLevelEvent[]>([]);
  const [processedActivities, setProcessedActivities] = useState<ProcessedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      setError(null);

      try {
        const [rawEventsRes, processedActivitiesRes] = await Promise.all([
          supabase
            .from('low_level_events')
            .select('*')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false }),
          supabase
            .from('user_activity_data')
            .select('*')
            .eq('session_id', sessionId)
            .order('client_timestamp', { ascending: false })
        ]);

        if (rawEventsRes.error) throw rawEventsRes.error;
        if (processedActivitiesRes.error) throw processedActivitiesRes.error;

        setRawEvents(rawEventsRes.data as LowLevelEvent[]);
        setProcessedActivities(processedActivitiesRes.data);

      } catch (err) {
        const anyErr = err as { message: string };
        console.error('Error fetching session data:', anyErr);
        setError(anyErr.message || 'Failed to fetch session data.');
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [sessionId]);
  
  const sortedAndCombinedLogs = useMemo(() => {
    const combined: CombinedLog[] = [
      ...rawEvents.map(e => ({ ...e, log_type: 'raw', sort_timestamp: e.created_at } as CombinedLog)),
      ...processedActivities.map(a => ({ ...a, log_type: 'processed', sort_timestamp: a.client_timestamp } as CombinedLog)),
    ];
    
    return combined.sort((a, b) => new Date(b.sort_timestamp).getTime() - new Date(a.sort_timestamp).getTime());
  }, [rawEvents, processedActivities]);


  if (loading) {
    return <div>Loading events...</div>;
  }
  
  if (error) {
    return <div className="text-red-500 font-bold p-4">Error: {error}</div>;
  }

  return (
    <div className="container mx-auto py-8 font-mono">
      <h1 className="text-2xl font-bold mb-4">Raw Session Inspector: {sessionId}</h1>
      <div className="space-y-4">
        {sortedAndCombinedLogs.map((log, index) => (
          <div key={index} className={`p-2 border rounded ${log.log_type === 'raw' ? 'bg-gray-100' : 'bg-blue-50'}`}>
            <div className="flex justify-between items-center mb-2 text-xs text-gray-500">
              <span className={`font-bold ${log.log_type === 'raw' ? 'text-gray-700' : 'text-blue-700'}`}>
                {log.log_type === 'raw' ? 'Low-Level Event' : 'Processed Activity'}
              </span>
              <span>{new Date(log.sort_timestamp).toISOString()}</span>
            </div>
            <pre className="p-2 text-xs overflow-auto">
              {JSON.stringify(log.log_type === 'raw' ? (log as LowLevelEvent).payload : (log as ProcessedActivity).item_data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
} 