'use client';

import { Button } from '@/components/ui/button';
import type { LowLevelEvent } from '@/types';
import { SignIn, useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function LowLevelSessionClient({ sessionId }: { sessionId: string }) {
  const [events, setEvents] = useState<LowLevelEvent[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isLoaded, userId, has } = useAuth();

  useEffect(() => {
    const fetchSessionData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Use the optimized API endpoint with sessionId filter
        const response = await fetch(`/api/low-level/session_owner?sessionId=${sessionId}`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to fetch session data: ${response.statusText}`);
        }
        
        const data = await response.json();
        setEvents(data.events || []);
        setOwnerId(data.userId || null);
        
      } catch (err) {
        console.error('Error fetching low-level session data:', err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }

      setLoading(false);
    };
    
    fetchSessionData();
  }, [sessionId]);

  if (!isLoaded || loading) {
    return <div>Loading session data...</div>;
  }

  if (!userId) {
    return (
      <div className="container mx-auto max-w-7xl py-4 flex justify-center">
        <SignIn />
      </div>
    );
  }

  if (error) {
    return <div>Error loading session data: {error}</div>;
  }

  const isOwner = userId === ownerId;
  const isAdmin = has({ role: 'org:admin' });

  if (!isOwner && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full space-y-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900">Access Denied</h2>
          <p className="text-gray-600">You do not have permission to view this session.</p>
          <Link href="/admin">
            <Button variant="outline">Return to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl py-8">
      <h1 className="text-2xl font-bold mb-4">Low-Level Session: {sessionId}</h1>
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
          <span className="text-sm font-medium text-blue-800">
            {events.length} events loaded
          </span>
          {events.length >= 1000 && (
            <span className="text-xs text-blue-600">(capped at 1000 most recent)</span>
          )}
        </div>
        {events.length >= 1000 && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded">
            [WARN] Only showing most recent 1000 events
          </div>
        )}
      </div>
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