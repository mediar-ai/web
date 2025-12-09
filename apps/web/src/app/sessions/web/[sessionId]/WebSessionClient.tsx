'use client';

import type { ActivityItem } from '@/types';
import { useEffect, useState } from 'react';

export default function WebSessionClient({ sessionId }: { sessionId: string }) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessionData = async () => {
      setLoading(true);

      try {
        const response = await fetch(`/api/sessions/web/${sessionId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch session data');
        }
        const { data } = await response.json();
        setActivity(data?.map((d: { item_data: ActivityItem }) => d.item_data as ActivityItem) || []);
      } catch (error) {
        console.error('Error fetching web recorder data:', error);
      }

      setLoading(false);
    };

    fetchSessionData();
  }, [sessionId]);

  if (loading) {
    return <div>Loading session data...</div>;
  }

  return (
    <div className="container mx-auto max-w-7xl py-8">
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