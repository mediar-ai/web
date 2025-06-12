'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { getSessions, type UserSessionData } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { useDebouncedCallback } from 'use-debounce';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';

const truncateId = (id: string) => `...${id.slice(-4)}`;

export default function AdminPage() {
  const [userSessions, setUserSessions] = useState<Record<string, UserSessionData>>({});
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userNameInput, setUserNameInput] = useState('');
  const [filter, setFilter] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());

  const toggleUserExpansion = (userId: string) => {
    setExpandedUsers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(userId)) {
        newSet.delete(userId);
      } else {
        newSet.add(userId);
      }
      return newSet;
    });
  };

  const fetchSessions = useCallback(async () => {
    console.log('[Admin] Fetching sessions...');
    const sessionData = await getSessions();
    setUserSessions(sessionData);
    console.log('[Admin] Sessions fetched:', Object.keys(sessionData).length, 'users');
  }, []);

  // Debounce for 2 seconds to handle the firehose of events and refresh efficiently.
  const debouncedFetchSessions = useDebouncedCallback(fetchSessions, 2000);

  useEffect(() => {
    const initialFetch = async () => {
      setLoading(true);
      await fetchSessions();
      setLoading(false);
    }
    initialFetch();

    const channel = supabase
      .channel('public:session_metadata')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_metadata' }, 
        () => {
          console.log('[Realtime] Change detected, queueing data refresh...');
          debouncedFetchSessions();
        }
      )
      .subscribe((status, err) => {
        console.log('[Realtime] Subscription status changed:', status);
        if (err) {
          console.error('[Realtime] Subscription error:', err as Error);
        }
      });

    return () => {
      console.log('[Realtime] Removing channel subscription.');
      supabase.removeChannel(channel);
    };
  }, [fetchSessions, debouncedFetchSessions]);

  const handleSaveName = async (userId: string) => {
    try {
      await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: userNameInput }),
      });
      setEditingUser(null);
      setUserNameInput('');
      debouncedFetchSessions(); // Refresh data using debounced fetch
    } catch (error) {
      console.error('Failed to save user name:', error);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-4">
        <h1 className="text-xl font-bold mb-3">Admin - All Sessions</h1>
        <div>Loading sessions...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4">
      <div className="flex justify-between items-center mb-3">
        <h1 className="text-xl font-bold">Admin - All Users</h1>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={fetchSessions}
            size="sm"
          >
            Refresh
          </Button>
          <Input 
            type="text"
            placeholder="Filter by User ID or Name..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 w-48"
          />
          <ThemeSwitcher />
        </div>
      </div>
      
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th scope="col" className="px-2 py-2">
              User
            </th>
            <th scope="col" className="px-2 py-2">
              Type(s)
            </th>
            <th scope="col" className="px-2 py-2">
              Sessions
            </th>
            <th scope="col" className="px-2 py-2">
              Total Events
            </th>
            <th scope="col" className="px-2 py-2">
              Processed Events
            </th>
            <th scope="col" className="px-2 py-2">
              Last Active
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(userSessions)
            .filter(([userId, userData]) => {
              if (!filter) return true;
              return userId.includes(filter) || 
                (userData.name && userData.name.toLowerCase().includes(filter.toLowerCase()));
            })
            .sort(([, aData], [, bData]) => {
              // Sort by most recent session activity
              const aLatest = Math.max(...aData.sessions.map(s => new Date(s.timestamp).getTime()));
              const bLatest = Math.max(...bData.sessions.map(s => new Date(s.timestamp).getTime()));
              return bLatest - aLatest;
            })
            .map(([userId, userData]) => {
              const liveSessions = userData.sessions.filter(s => s.status === 'live').length;
              const totalEvents = userData.sessions.reduce((sum, s) => sum + s.eventCount, 0);
              const totalProcessedEvents = userData.sessions.reduce((sum, s) => sum + (s.processed_event_count || 0), 0);
              const mostRecentSession = userData.sessions.sort((a, b) => 
                new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              )[0];

              return (
                <React.Fragment key={userId}>
                  <tr className="bg-white border-b hover:bg-gray-50">
                    <td className="px-2 py-1 font-medium text-gray-900 whitespace-nowrap">
                      <div className="flex items-center">
                        <button
                          onClick={() => toggleUserExpansion(userId)}
                          className="mr-2 p-1 hover:bg-gray-200 rounded"
                        >
                          {expandedUsers.has(userId) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                        {editingUser === userId ? (
                          <div className="flex items-center">
                            <Input
                              type="text"
                              value={userNameInput}
                              onChange={(e) => setUserNameInput(e.target.value)}
                              placeholder="Enter user name"
                              className="mr-2 h-8"
                            />
                            <Button onClick={() => handleSaveName(userId)} className="mr-2 h-8">Save</Button>
                            <Button variant="outline" onClick={() => setEditingUser(null)} className="h-8">Cancel</Button>
                          </div>
                        ) : (
                          <div 
                            className="flex items-center gap-2 cursor-pointer group"
                            onClick={() => {
                              setEditingUser(userId);
                              setUserNameInput(userData.name || '');
                            }}
                          >
                            <span className="mr-2 border-b border-dotted border-gray-400 group-hover:border-gray-600">{userData.name || `User ${truncateId(userId)}`}</span>
                            <Pencil className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        )}
                        {liveSessions > 0 && (
                          <span className="flex items-center gap-1.5 ml-2">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                            </span>
                            <span className="text-xs text-green-600 font-semibold">LIVE</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex items-center gap-1">
                        {[...new Set(userData.sessions.map(s => s.type))].map((type, index) => (
                          <span key={`${type}-${index}`} className={`px-2 py-0.5 text-xs rounded-full ${
                            type === 'lowLevel' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                          }`}>
                            {type === 'lowLevel' ? 'Low-Level' : 'Web'}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      {userData.sessions.length}
                    </td>
                    <td className="px-2 py-1">
                      {totalEvents}
                    </td>
                    <td className="px-2 py-1">
                      {totalProcessedEvents}
                    </td>
                    <td className="px-2 py-1">
                      {mostRecentSession ? new Date(mostRecentSession.timestamp).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Link href={`/?userId=${userId}`}>
                        <Button size="sm">View Recordings</Button>
                      </Link>
                    </td>
                  </tr>
                  {expandedUsers.has(userId) && (
                    <tr>
                      <td colSpan={7} className="px-8 py-2 bg-gray-50">
                        <div className="space-y-1">
                          {userData.sessions
                            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                            .map((session) => (
                              <div key={session.id} className="flex items-center justify-between py-1 px-2 text-sm bg-white rounded border">
                                <div className="flex items-center gap-3">
                                  <span className="font-mono text-xs">{truncateId(session.id)}</span>
                                  <span className={`px-2 py-0.5 text-xs rounded ${
                                    session.type === 'lowLevel' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                                  }`}>
                                    {session.type === 'lowLevel' ? 'Low-Level' : 'Web'}
                                  </span>
                                  <span>{session.eventCount} raw events</span>
                                  <span className="font-semibold">{session.processed_event_count || 0} processed</span>
                                  <span className={`px-2 py-0.5 text-xs rounded-full ${
                                    session.status === 'live' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                                  }`}>
                                    {session.status}
                                  </span>
                                  <span className="text-gray-500">{new Date(session.timestamp).toLocaleString()}</span>
                                </div>
                                <Link href={`/sessions/${session.type}/${session.id}`}>
                                  <Button size="sm" variant="outline">Raw JSON Session Logs</Button>
                                </Link>
                              </div>
                            ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
} 