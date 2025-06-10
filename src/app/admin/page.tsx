'use client';

import { useEffect, useState } from 'react';
import { getSessions } from '@/lib/db';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function AdminPage() {
  const [sessions, setSessions] = useState<{ lowLevel: string[], web: string[] }>({ lowLevel: [], web: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSessions = async () => {
      setLoading(true);
      const sessionData = await getSessions();
      setSessions(sessionData);
      setLoading(false);
    };
    fetchSessions();
  }, []);

  if (loading) {
    return <div>Loading sessions...</div>;
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-4">Admin - All Sessions</h1>
      
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-2">Low-Level Windows Event Sessions</h2>
        <div className="space-y-2">
          {sessions.lowLevel.length > 0 ? (
            sessions.lowLevel.map(sessionId => (
              <div key={sessionId} className="flex items-center justify-between p-2 border rounded">
                <span>{sessionId}</span>
                <Link href={`/sessions/low-level/${sessionId}`}>
                  <Button>View Session</Button>
                </Link>
              </div>
            ))
          ) : (
            <p>No low-level event sessions found.</p>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-2">Web Recorder Sessions</h2>
        <div className="space-y-2">
          {sessions.web.length > 0 ? (
            sessions.web.map(sessionId => (
              <div key={sessionId} className="flex items-center justify-between p-2 border rounded">
                <span>{sessionId}</span>
                <Link href={`/sessions/web/${sessionId}`}>
                  <Button>View Session</Button>
                </Link>
              </div>
            ))
          ) : (
            <p>No web recorder sessions found.</p>
          )}
        </div>
      </div>
    </div>
  );
} 