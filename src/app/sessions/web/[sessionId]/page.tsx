'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ActivityItem } from '@/types';

export default function WebSessionPage({ params }: { params: { sessionId: string } }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessionData = async () => {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('user_activity_data')
        .select('*')
        .eq('session_id', params.sessionId)
        .order('client_timestamp', { ascending: false });

      if (error) console.error('Error fetching web recorder data:', error);
      else setActivity(data?.map(d => d.item_data as ActivityItem) || []);

      setLoading(false);
    };
    
    fetchSessionData();
  }, [params.sessionId]);

  if (loading) {
    return <div>Loading session data...</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Web Recorder Session: {params.sessionId}</h1>
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